import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, LoaderCircle, MessageSquarePlus, Mic, MicOff, SendHorizonal, Trash2, User } from 'lucide-react';
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
  type StreamPlanPayload,
  type ChatMessage,
  type ConversationMeta
} from '../services/chatClient';
import {
  getAllLinkedConversationIds,
  getPlanConversationIds,
  linkConversationToPlan,
  upsertGeneratedPlan
} from '../data/plansStore';
import type { TravelPlan } from '../data/mockPlans';

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: '你好，我会结合当前会话里的历史消息来回答你。',
  createdAt: 0
};

const PLAN_CONTEXT_PREFIX = '以下是当前关联的旅行计划，请你基于该计划继续对话与调整。';
const PLAN_CONTEXT_USER_MARKER = '\n\n用户的新问题：';

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

function summarizePlanForPrompt(plan: TravelPlan) {
  const daySummaries = plan.days
    .map((day) => {
      const titles = day.activities.map((activity) => activity.title).slice(0, 5);
      return `第${day.day}天(${day.date})：${titles.join('、')}`;
    })
    .join('\n');

  return [
    '以下是当前关联的旅行计划，请你基于该计划继续对话与调整。',
    '不要逐字复述全部计划，只需在用户要求时输出修改结果。',
    `计划ID：${plan.id}`,
    `计划名称：${plan.name}`,
    `目的地：${plan.destination}`,
    `时长：${plan.duration}`,
    `亮点：${plan.highlight}`,
    `日程概览：\n${daySummaries}`
  ].join('\n');
}

function normalizeMessageForDisplay(message: ChatMessage, isPlanScoped: boolean): ChatMessage {
  if (!isPlanScoped || message.role !== 'user') return message;
  if (!message.content.startsWith(PLAN_CONTEXT_PREFIX)) return message;
  const markerIndex = message.content.indexOf(PLAN_CONTEXT_USER_MARKER);
  if (markerIndex < 0) return message;
  const nextContent = message.content.slice(markerIndex + PLAN_CONTEXT_USER_MARKER.length).trim();
  if (!nextContent) return message;
  return {
    ...message,
    content: nextContent
  };
}

function normalizeMessagesForDisplay(messages: ChatMessage[], isPlanScoped: boolean) {
  return messages.map((message) => normalizeMessageForDisplay(message, isPlanScoped));
}

interface TravelChatPanelProps {
  onPlanGenerated?: (plan: TravelPlan) => void;
  relatedPlan?: TravelPlan;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtorLike = new () => SpeechRecognitionLike;

export function TravelChatPanel({ onPlanGenerated, relatedPlan }: TravelChatPanelProps) {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [relatedConversationIds, setRelatedConversationIds] = useState<string[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [error, setError] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const sendLockRef = useRef(false);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechBaseDraftRef = useRef('');
  const draftRef = useRef('');
  const isPlanScoped = Boolean(relatedPlan);
  const speechRecognitionCtor = useMemo<SpeechRecognitionCtorLike | null>(() => {
    if (typeof window === 'undefined') return null;
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionCtorLike;
      webkitSpeechRecognition?: SpeechRecognitionCtorLike;
    };
    return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
  }, []);
  const speechSupported = Boolean(speechRecognitionCtor);

  const focusInput = () => {
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const scopedConversationIds = useMemo(() => {
    if (!relatedPlan) return [];
    if (relatedConversationIds.length > 0) return relatedConversationIds;
    return getPlanConversationIds(relatedPlan.id);
  }, [relatedConversationIds, relatedPlan]);

  const getFilteredConversations = (list: ConversationMeta[], idsOverride?: string[]) => {
    if (!isPlanScoped) {
      const linkedConversationIds = new Set(getAllLinkedConversationIds());
      return list.filter((item) => !linkedConversationIds.has(item.id));
    }
    const ids = idsOverride ?? scopedConversationIds;
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return list.filter((item) => idSet.has(item.id));
  };

  const refreshConversations = async (preferredConversationId?: string, idsOverride?: string[]) => {
    const list = await listConversations();
    const scopedList = getFilteredConversations(list, idsOverride);
    setConversations(scopedList);

    const nextActiveId =
      preferredConversationId && scopedList.some((item) => item.id === preferredConversationId)
        ? preferredConversationId
        : '';
    if (!nextActiveId) {
      setActiveConversationId('');
      setMessages([]);
      return;
    }
    const data = await getConversationMessages(nextActiveId);
    setActiveConversationId(nextActiveId);
    setMessages(normalizeMessagesForDisplay(data.messages, isPlanScoped));
  };

  useEffect(() => {
    let isActive = true;
    const init = async () => {
      setIsLoadingConversations(true);
      try {
        const planConversationIds = relatedPlan ? getPlanConversationIds(relatedPlan.id) : [];
        if (!isActive) return;
        setRelatedConversationIds(planConversationIds);

        const list = await listConversations();
        if (!isActive) return;

        const scopedList = relatedPlan
          ? getFilteredConversations(list, planConversationIds)
          : getFilteredConversations(list);
        setConversations(scopedList);

        // 每次进入页面默认新对话模式
        setActiveConversationId('');
        setMessages([]);
        focusInput();
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
  }, [relatedPlan?.id]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, isSending]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!speechRecognitionCtor) return;

    const recognition = new speechRecognitionCtor();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setSpeechError('');
      setIsListening(true);
      speechBaseDraftRef.current = draftRef.current.trim();
    };

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      const normalizedTranscript = transcript.trim();
      if (!normalizedTranscript) return;
      const baseDraft = speechBaseDraftRef.current;
      setDraft(baseDraft ? `${baseDraft} ${normalizedTranscript}` : normalizedTranscript);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setSpeechError('麦克风权限被拒绝，请开启后重试');
      } else if (event.error === 'no-speech') {
        setSpeechError('未识别到语音，请再试一次');
      } else {
        setSpeechError('语音识别失败，请稍后重试');
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    speechRecognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
      speechRecognitionRef.current = null;
    };
  }, [speechRecognitionCtor]);

  const visibleMessages = messages.length > 0 ? messages : [WELCOME_MESSAGE];

  const handleCreateConversation = async () => {
    if (isSending) return;
    setActiveConversationId('');
    setMessages([]);
    setDraft('');
    setError('');
    focusInput();
  };

  const handleSwitchConversation = async (conversationId: string) => {
    if (isSending || conversationId === activeConversationId) return;
    try {
      setError('');
      const data = await getConversationMessages(conversationId);
      setActiveConversationId(conversationId);
      setMessages(normalizeMessagesForDisplay(data.messages, isPlanScoped));
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
    speechRecognitionRef.current?.stop();
    sendLockRef.current = true;
    setIsSending(true);
    setError('');

    let conversationId = activeConversationId;
    const isNewConversation = !conversationId;
    if (!conversationId) {
      try {
        const created = await createConversation();
        conversationId = created.id;

        let nextScopedConversationIds = scopedConversationIds;
        if (relatedPlan) {
          linkConversationToPlan(relatedPlan.id, conversationId);
          nextScopedConversationIds = Array.from(new Set([...scopedConversationIds, conversationId]));
          setRelatedConversationIds(nextScopedConversationIds);
        }

        const nextList = getFilteredConversations(
          [created, ...conversations.filter((item) => item.id !== created.id)],
          nextScopedConversationIds
        );
        setConversations(nextList);
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
      const planContext = relatedPlan ? summarizePlanForPrompt(relatedPlan) : undefined;

      await sendConversationMessageStream(
        conversationId,
        content,
        (chunk) => {
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
        },
        (plan: StreamPlanPayload, nextAssistantMessage?: string) => {
          upsertGeneratedPlan(plan);
          if (relatedPlan) {
            linkConversationToPlan(relatedPlan.id, conversationId);
            setRelatedConversationIds((current) => Array.from(new Set([...current, conversationId])));
            linkConversationToPlan(plan.id, conversationId);
          }
          onPlanGenerated?.(plan);
          if (!nextAssistantMessage) return;
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: nextAssistantMessage
                  }
                : item
            )
          );
        },
        (plan: StreamPlanPayload, targetPlanId?: string, nextAssistantMessage?: string) => {
          upsertGeneratedPlan(plan);
          if (relatedPlan) {
            linkConversationToPlan(relatedPlan.id, conversationId);
            setRelatedConversationIds((current) => Array.from(new Set([...current, conversationId])));
          }
          if (targetPlanId && relatedPlan?.id && targetPlanId !== relatedPlan.id) {
            linkConversationToPlan(targetPlanId, conversationId);
          }
          onPlanGenerated?.(plan);
          if (!nextAssistantMessage) return;
          setMessages((current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: nextAssistantMessage
                  }
                : item
            )
          );
        },
        {
          planContext,
          targetPlanId: relatedPlan?.id,
          currentPlan: relatedPlan
        }
      );

      const refreshIds = relatedPlan
        ? Array.from(new Set([...scopedConversationIds, conversationId]))
        : undefined;
      await refreshConversations(conversationId, refreshIds);
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

  const handleVoiceInput = () => {
    const recognition = speechRecognitionRef.current;
    if (!recognition) {
      setSpeechError('当前浏览器不支持语音输入');
      return;
    }

    if (isListening) {
      recognition.stop();
      return;
    }

    setSpeechError('');
    try {
      recognition.start();
    } catch (nextError) {
      setSpeechError('语音识别启动失败，请重试');
      setIsListening(false);
      console.error('语音识别启动失败', nextError);
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
              {relatedPlan ? (
                <p className="text-xs text-muted-foreground mt-1">
                  当前计划：{relatedPlan.name} · 每次进入默认新对话
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">会话历史已保存到数据库，可创建多个会话。</p>
              )}
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
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {relatedPlan ? '暂无关联会话，发送消息后会创建基于该计划的新会话。' : '暂无会话，点击右上角新建。'}
              </p>
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
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="输入你想让 AI 调整的内容..."
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
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant={isListening ? 'destructive' : 'outline'}
                onClick={handleVoiceInput}
                disabled={isSending || !speechSupported}
                title={isListening ? '停止语音输入' : '开始语音输入'}
                aria-label={isListening ? '停止语音输入' : '开始语音输入'}
              >
                {isListening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>
              <Button
                onClick={() => void handleSendMessage()}
                disabled={isSending || !draft.trim()}
              >
                <SendHorizonal className="size-4" />
                发送
              </Button>
            </div>
          </div>
          {speechError && <p className="mt-3 text-sm text-red-500">{speechError}</p>}
          {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
        </div>
      </div>
    </aside>
  );
}
