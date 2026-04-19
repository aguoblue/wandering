export interface ChatReply {
  reply: string;
  usage?: {
    model?: string;
  };
}

interface ChatStreamEvent {
  delta?: string;
  done?: boolean;
  model?: string;
  error?: string;
}

export async function sendChatMessage(message: string) {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || 'AI 对话失败');
  }

  const data = (await response.json()) as ChatReply;
  if (!data?.reply || typeof data.reply !== 'string') {
    throw new Error('AI 返回了空内容');
  }

  return data;
}

export async function sendChatMessageStream(
  message: string,
  onDelta: (chunk: string) => void
) {
  const response = await fetch('/api/ai/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({ message })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; detail?: string }
      | null;
    throw new Error(payload?.error || payload?.detail || 'AI 流式对话失败');
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
      const dataLine = rawEvent
        .split('\n')
        .find((line) => line.startsWith('data:'));
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
