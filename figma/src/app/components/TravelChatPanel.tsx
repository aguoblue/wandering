import { useEffect, useRef, useState } from 'react';
import { Bot, LoaderCircle, SendHorizonal, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { sendChatMessageStream } from '../services/chatClient';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我现在是一个无记忆版本的 AI 助手。你每次发来的问题，我都会独立回答，不会自动参考上一次对话。'
};

export function TravelChatPanel() {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isSending]);

  const handleSendMessage = async () => {
    const content = draft.trim();
    if (!content || isSending) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content
    };

    setMessages((current) => [...current, userMessage]);
    setDraft('');
    setIsSending(true);
    setError('');

    const assistantId = `assistant-${Date.now()}`;
    setStreamingAssistantId(assistantId);
    setMessages((current) => [
      ...current,
      {
        id: assistantId,
        role: 'assistant',
        content: ''
      }
    ]);

    try {
      await sendChatMessageStream(content, (chunk) => {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content + chunk
                }
              : message
          )
        );
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '发送失败，请稍后再试');
    } finally {
      setIsSending(false);
      setStreamingAssistantId(null);
    }
  };

  return (
    <aside className="rounded-2xl border bg-white shadow-sm xl:sticky xl:top-24">
      <div className="border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <Bot className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">AI 对话框</h2>
            <p className="text-xs text-muted-foreground mt-1">第一版为单轮问答，同一会话中的每次提问都会独立发送给 AI。</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div ref={messagesContainerRef} className="max-h-[420px] space-y-3 overflow-auto pr-1">
          {messages.map((message) => {
            const isAssistant = message.role === 'assistant';
            return (
              <div
                key={message.id}
                className={`flex gap-3 ${isAssistant ? 'items-start' : 'items-start justify-end'}`}
              >
                {isAssistant && (
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                    <Bot className="size-4" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${
                    isAssistant
                      ? 'bg-slate-100 text-slate-800'
                      : 'bg-blue-600 text-white'
                  }`}
                >
                  {isAssistant && message.id === streamingAssistantId && !message.content ? (
                    <span className="inline-flex items-center gap-2 text-slate-600">
                      <LoaderCircle className="size-4 animate-spin" />
                      AI 正在思考...
                    </span>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        pre: ({ children }) => (
                          <pre className="my-2 overflow-x-auto rounded-lg bg-black/85 p-3 text-xs text-white">
                            {children}
                          </pre>
                        ),
                        code: ({ inline, children }) =>
                          inline ? (
                            <code className="rounded bg-black/10 px-1 py-0.5 text-[0.9em]">{children}</code>
                          ) : (
                            <code>{children}</code>
                          ),
                        a: ({ href, children }) => (
                          <a
                            className="underline underline-offset-2"
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {children}
                          </a>
                        ),
                        ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>
                {!isAssistant && (
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
                    <User className="size-4" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-xl border bg-slate-50 p-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="输入你想问 AI 的问题..."
            className="min-h-28 bg-white"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                void handleSendMessage();
              }
            }}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">支持 `Cmd/Ctrl + Enter` 快速发送</p>
            <Button onClick={() => void handleSendMessage()} disabled={isSending || !draft.trim()}>
              <SendHorizonal className="size-4" />
              发送
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
