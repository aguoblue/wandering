import type { TravelPlan } from '../data/mockPlans';

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

export type StreamPlanPayload = TravelPlan;

interface ChatStreamEvent {
  type?: 'delta' | 'plan' | 'plan_update' | 'done' | 'error';
  delta?: string;
  plan?: StreamPlanPayload;
  targetPlanId?: string;
  assistantMessage?: string;
  done?: boolean;
  model?: string;
  error?: string;
}

const API_UNAVAILABLE_MESSAGE = 'AI 后端服务未连接，请在 my-app 目录运行 npm run ai:server 后刷新页面';

function normalizeError(payload: unknown, fallback: string) {
  if (typeof payload === 'string') {
    return payload.includes('Error occurred while trying to proxy')
      ? API_UNAVAILABLE_MESSAGE
      : payload || fallback;
  }
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as { error?: string; detail?: string };
  return record.error || record.detail || fallback;
}

async function readErrorPayload(response: Response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function listConversations() {
  let response: Response;
  try {
    response = await fetch('/api/conversations');
  } catch {
    throw new Error(API_UNAVAILABLE_MESSAGE);
  }
  if (!response.ok) {
    const payload = await readErrorPayload(response);
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
  onDelta: (chunk: string) => void,
  onPlan?: (plan: StreamPlanPayload, assistantMessage?: string) => void,
  onPlanUpdate?: (plan: StreamPlanPayload, targetPlanId?: string, assistantMessage?: string) => void,
  options?: {
    planContext?: string;
    targetPlanId?: string;
    currentPlan?: StreamPlanPayload;
  }
) {
  const requestBody: {
    message: string;
    planContext?: string;
    targetPlanId?: string;
    currentPlan?: StreamPlanPayload;
  } = { message };
  if (options?.planContext?.trim()) {
    requestBody.planContext = options.planContext.trim();
  }
  if (options?.targetPlanId?.trim()) {
    requestBody.targetPlanId = options.targetPlanId.trim();
  }
  if (options?.currentPlan) {
    requestBody.currentPlan = options.currentPlan;
  }

  const response = await fetch(`/api/conversations/${conversationId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify(requestBody)
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
      if (payload.type === 'plan' && payload.plan && onPlan) {
        onPlan(payload.plan, payload.assistantMessage);
      }
      if (payload.type === 'plan_update' && payload.plan && onPlanUpdate) {
        onPlanUpdate(payload.plan, payload.targetPlanId, payload.assistantMessage);
      }
      if (typeof payload.delta === 'string' && payload.delta) {
        onDelta(payload.delta);
      }
      if (payload.done || payload.type === 'done') {
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
