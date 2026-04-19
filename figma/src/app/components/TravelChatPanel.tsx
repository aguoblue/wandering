import { useEffect, useRef, useState } from 'react';
import { Bot, LoaderCircle, MessageSquarePlus, SendHorizonal, Trash2, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { sendChatMessageStream, type ChatTurn } from '../services/chatClient';
import {
  activateConversation,
  createConversationAndActivate,
  deleteConversationAndSelectNext,
  ensureChatState,
  saveConversationMessages,
  type ChatConversationMeta,
  type StoredChatMessage
} from '../data/chatStore';

type ChatMessage = StoredChatMessage;

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我会结合当前会话里的历史消息来回答你。',
  createdAt: 0
};

function toApiTurns(messages: ChatMessage[], currentUserInput: string): ChatTurn[] {
  const history = messages
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }))
    .filter((item) => item.content.length > 0);

  history.push({
    role: 'user',
    content: currentUserInput
  });

  // Keep recent turns to avoid oversized payloads.
  return history.slice(-24);
}

function formatConversationTime(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const isSameYear = date.getFullYear() === now.getFullYear();
  const isSameDay =
    isSameYear &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  if (isSameYear) {
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function TravelChatPanel() {
  const [conversations, setConversations] = useState<ChatConversationMeta[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const initialState = ensureChatState();
    setConversations(initialState.conversations);
    setActiveConversationId(initialState.activeConversationId);
    setMessages(initialState.messages);
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isSending]);

  const visibleMessages = messages.length > 0 ? messages : [WELCOME_MESSAGE];

  const handleCreateConversation = () => {
    if (isSending) return;
    const nextState = createConversationAndActivate();
    setConversations(nextState.conversations);
    setActiveConversationId(nextState.activeConversationId);
    setMessages(nextState.messages);
    setDraft('');
    setError('');
  };

  const handleSwitchConversation = (conversationId: string) => {
    if (isSending || conversationId === activeConversationId) return;
    const nextState = activateConversation(conversationId);
    setConversations(nextState.conversations);
    setActiveConversationId(nextState.activeConversationId);
    setMessages(nextState.messages);
    setDraft('');
    setError('');
  };

  const handleDeleteConversation = (conversationId: string) => {
    if (isSending) return;
    const nextState = deleteConversationAndSelectNext(conversationId);
    setConversations(nextState.conversations);
    setActiveConversationId(nextState.activeConversationId);
    setMessages(nextState.messages);
    setError('');
  };

  const handleSendMessage = async () => {
    const content = draft.trim();
    if (!content || isSending || !activeConversationId) return;
    const conversationId = activeConversationId;
    const apiTurns = toApiTurns(messages, content);
    const now = Date.now();

    const userMessage: ChatMessage = {
      id: `user-${now}`,
      role: 'user',
      content,
      createdAt: now
    };

    setDraft('');
    setIsSending(true);
    setError('');

    const assistantId = `assistant-${now + 1}`;
    setStreamingAssistantId(assistantId);
    setMessages((current) => {
      const next = [
        ...current,
        userMessage,
        {
          id: assistantId,
          role: 'assistant' as const,
          content: '',
          createdAt: now + 1
        }
      ];
      return next;
    });

    try {
      await sendChatMessageStream(apiTurns, (chunk) => {
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
      setMessages((current) => {
        const finalized = current.filter(
          (message) => !(message.id === assistantId && !message.content.trim())
        );
        setConversations(saveConversationMessages(conversationId, finalized));
        return finalized;
      });
    }
  };

  return (
    <aside className="rounded-2xl border bg-white shadow-sm xl:sticky xl:top-24">
      <div className="border-b px-5 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <Bot className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">AI 对话框</h2>
              <p className="text-xs text-muted-foreground mt-1">支持会话内上下文；可创建多个本地会话历史。</p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleCreateConversation}
            disabled={isSending}
            className="gap-1.5 shrink-0"
          >
            <MessageSquarePlus className="size-4" />
            新建
          </Button>
        </div>

        <div className="rounded-lg border bg-slate-50 p-2">
          <div className="max-h-40 space-y-1 overflow-auto">
            {conversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId;
              return (
                <div
                  key={conversation.id}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors ${
                    isActive ? 'bg-blue-100' : 'hover:bg-white'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => handleSwitchConversation(conversation.id)}
                    disabled={isSending}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-sm font-medium text-slate-800">{conversation.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {conversation.messageCount} 条消息 · {formatConversationTime(conversation.updatedAt)}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteConversation(conversation.id);
                    }}
                    disabled={isSending}
                    className="inline-flex size-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
                    aria-label="删除会话"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div ref={messagesContainerRef} className="max-h-[420px] space-y-3 overflow-auto pr-1">
          {visibleMessages.map((message) => {
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
