export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface ChatStreamEvent {
  delta?: string;
  done?: boolean;
  model?: string;
  error?: string;
}

function normalizeError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as { error?: string; detail?: string };
  return record.error || record.detail || fallback;
}

export async function listConversations() {
  const response = await fetch('/api/conversations');
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(normalizeError(payload, '加载会话列表失败'));
  }
  const data = (await response.json()) as { conversations?: ConversationMeta[] };
  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function createConversation() {
  const response = await fetch('/api/conversations', {
    method: 'POST'
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(normalizeError(payload, '创建会话失败'));
  }
  const data = (await response.json()) as { conversation?: ConversationMeta };
  if (!data.conversation) {
    throw new Error('会话创建失败');
  }
  return data.conversation;
}

export async function deleteConversation(conversationId: string) {
  const response = await fetch(`/api/conversations/${conversationId}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(normalizeError(payload, '删除会话失败'));
  }
}

export async function getConversationMessages(conversationId: string) {
  const response = await fetch(`/api/conversations/${conversationId}/messages`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(normalizeError(payload, '加载会话消息失败'));
  }
  const data = (await response.json()) as {
    conversation?: ConversationMeta;
    messages?: ChatMessage[];
  };
  return {
    conversation: data.conversation ?? null,
    messages: Array.isArray(data.messages) ? data.messages : []
  };
}

export async function sendConversationMessageStream(
  conversationId: string,
  message: string,
  onDelta: (chunk: string) => void
) {
  const response = await fetch(`/api/conversations/${conversationId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(normalizeError(payload, 'AI 流式对话失败'));
  }

  if (!response.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const rawEvent of events) {
      const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;

      const payloadText = dataLine.slice(5).trim();
      if (!payloadText) continue;

      let payload: ChatStreamEvent | null = null;
      try {
        payload = JSON.parse(payloadText) as ChatStreamEvent;
      } catch {
        continue;
      }

      if (!payload) continue;
      if (payload.error) {
        throw new Error(payload.error);
      }
      if (typeof payload.delta === 'string' && payload.delta) {
        onDelta(payload.delta);
      }
      if (payload.done) {
        return {
          usage: {
            model: payload.model
          }
        };
      }
    }
  }

  return {
    usage: {}
  };
}
