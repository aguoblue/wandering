import { useEffect, useRef, useState } from 'react';
import { Bot, LoaderCircle, MessageSquarePlus, SendHorizonal, Trash2, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import {
  createConversation,
  deleteConversation,
  getConversationMessages,
  listConversations,
  sendConversationMessageStream,
  type ChatMessage,
  type ConversationMeta
} from '../services/chatClient';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我会结合当前会话里的历史消息来回答你。',
  createdAt: 0
};

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
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [error, setError] = useState('');
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const sendLockRef = useRef(false);

  const refreshConversations = async (preferredConversationId?: string) => {
    const list = await listConversations();
    setConversations(list);
    const nextActiveId =
      preferredConversationId && list.some((item) => item.id === preferredConversationId)
        ? preferredConversationId
        : '';
    if (!nextActiveId) {
      setActiveConversationId('');
      setMessages([]);
      return;
    }
    const data = await getConversationMessages(nextActiveId);
    setActiveConversationId(nextActiveId);
    setMessages(data.messages);
  };

  useEffect(() => {
    let isActive = true;
    const init = async () => {
      setIsLoadingConversations(true);
      try {
        const list = await listConversations();

        if (!isActive) return;
        setConversations(list);
        setActiveConversationId('');
        setMessages([]);
      } catch (nextError) {
        if (!isActive) return;
        setError(nextError instanceof Error ? nextError.message : '加载会话失败');
      } finally {
        if (isActive) {
          setIsLoadingConversations(false);
        }
      }
    };

    void init();
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isSending]);

  const visibleMessages = messages.length > 0 ? messages : [WELCOME_MESSAGE];

  const handleCreateConversation = async () => {
    if (isSending) return;
    setActiveConversationId('');
    setMessages([]);
    setDraft('');
    setError('');
  };

  const handleSwitchConversation = async (conversationId: string) => {
    if (isSending || conversationId === activeConversationId) return;
    try {
      setError('');
      const data = await getConversationMessages(conversationId);
      setActiveConversationId(conversationId);
      setMessages(data.messages);
      setDraft('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '切换会话失败');
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    if (isSending) return;
    try {
      setError('');
      await deleteConversation(conversationId);
      const fallbackId =
        conversationId === activeConversationId
          ? ''
          : activeConversationId;
      await refreshConversations(fallbackId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '删除会话失败');
    }
  };

  const handleSendMessage = async () => {
    const content = draft.trim();
    if (!content || isSending || sendLockRef.current) return;
    sendLockRef.current = true;
    setIsSending(true);
    setError('');

    let conversationId = activeConversationId;
    if (!conversationId) {
      try {
        const created = await createConversation();
        conversationId = created.id;
        setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
        setActiveConversationId(conversationId);
        setMessages([]);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '创建会话失败');
        setIsSending(false);
        sendLockRef.current = false;
        return;
      }
    }

    const now = Date.now();
    const userMessage: ChatMessage = {
      id: `tmp-user-${now}`,
      role: 'user',
      content,
      createdAt: now
    };

    const assistantId = `tmp-assistant-${now + 1}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: now + 1
    };

    setDraft('');
    setStreamingAssistantId(assistantId);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    try {
      await sendConversationMessageStream(conversationId, content, (chunk) => {
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: item.content + chunk
                }
              : item
          )
        );
      });

      await refreshConversations(conversationId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '发送失败，请稍后再试');
      setMessages((current) =>
        current.filter((item) => item.id !== userMessage.id && item.id !== assistantId)
      );
    } finally {
      setIsSending(false);
      setStreamingAssistantId(null);
      sendLockRef.current = false;
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
              <p className="text-xs text-muted-foreground mt-1">会话历史已保存到数据库，可创建多个会话。</p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleCreateConversation()}
            disabled={isSending || isLoadingConversations}
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
                    onClick={() => void handleSwitchConversation(conversation.id)}
                    disabled={isSending || isLoadingConversations}
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
                      void handleDeleteConversation(conversation.id);
                    }}
                    disabled={isSending || isLoadingConversations}
                    className="inline-flex size-7 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
                    aria-label="删除会话"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              );
            })}
            {conversations.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">暂无会话，点击右上角新建。</p>
            )}
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
                    isAssistant ? 'bg-slate-100 text-slate-800' : 'bg-blue-600 text-white'
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
            <Button
              onClick={() => void handleSendMessage()}
              disabled={isSending || !draft.trim()}
            >
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
