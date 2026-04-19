export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface ChatConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface ChatIndex {
  activeConversationId: string | null;
  conversations: ChatConversationMeta[];
}

interface ChatStateSnapshot {
  conversations: ChatConversationMeta[];
  activeConversationId: string;
  messages: StoredChatMessage[];
}

const INDEX_KEY = 'travel-chat:index:v1';
const CONVERSATION_KEY_PREFIX = 'travel-chat:conv:';
const DEFAULT_TITLE = '新对话';
const MAX_MESSAGES_PER_CONVERSATION = 200;

function conversationKey(conversationId: string) {
  return `${CONVERSATION_KEY_PREFIX}${conversationId}:v1`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function sortConversations(conversations: ChatConversationMeta[]) {
  return conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

function createConversationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `conv_${crypto.randomUUID()}`;
  }
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(messages: StoredChatMessage[]) {
  const firstUserMessage = messages.find((item) => item.role === 'user' && item.content.trim());
  if (!firstUserMessage) return DEFAULT_TITLE;
  return firstUserMessage.content.replace(/\s+/g, ' ').trim().slice(0, 24) || DEFAULT_TITLE;
}

function createEmptyConversation(now = Date.now()): {
  meta: ChatConversationMeta;
  messages: StoredChatMessage[];
} {
  const id = createConversationId();
  return {
    meta: {
      id,
      title: DEFAULT_TITLE,
      createdAt: now,
      updatedAt: now,
      messageCount: 0
    },
    messages: []
  };
}

function readIndex(): ChatIndex {
  return readJson<ChatIndex>(INDEX_KEY, {
    activeConversationId: null,
    conversations: []
  });
}

function writeIndex(index: ChatIndex) {
  writeJson(INDEX_KEY, {
    activeConversationId: index.activeConversationId,
    conversations: sortConversations(index.conversations)
  });
}

function readConversationMessages(conversationId: string) {
  return readJson<StoredChatMessage[]>(conversationKey(conversationId), []);
}

function writeConversationMessages(conversationId: string, messages: StoredChatMessage[]) {
  writeJson(conversationKey(conversationId), messages.slice(-MAX_MESSAGES_PER_CONVERSATION));
}

export function ensureChatState(): ChatStateSnapshot {
  const index = readIndex();
  let conversations = sortConversations(index.conversations);
  let activeConversationId = index.activeConversationId;

  if (conversations.length === 0) {
    const created = createEmptyConversation();
    conversations = [created.meta];
    activeConversationId = created.meta.id;
    writeConversationMessages(created.meta.id, created.messages);
  }

  if (!activeConversationId || !conversations.some((item) => item.id === activeConversationId)) {
    activeConversationId = conversations[0].id;
  }

  writeIndex({
    activeConversationId,
    conversations
  });

  return {
    conversations,
    activeConversationId,
    messages: readConversationMessages(activeConversationId)
  };
}

export function createConversationAndActivate(): ChatStateSnapshot {
  const index = readIndex();
  const created = createEmptyConversation();
  const conversations = sortConversations([created.meta, ...index.conversations]);
  const activeConversationId = created.meta.id;
  writeConversationMessages(activeConversationId, []);
  writeIndex({
    activeConversationId,
    conversations
  });
  return {
    conversations,
    activeConversationId,
    messages: []
  };
}

export function activateConversation(conversationId: string): ChatStateSnapshot {
  const index = readIndex();
  const conversations = sortConversations(index.conversations);
  const safeId = conversations.some((item) => item.id === conversationId)
    ? conversationId
    : conversations[0]?.id;

  if (!safeId) {
    return ensureChatState();
  }

  writeIndex({
    activeConversationId: safeId,
    conversations
  });

  return {
    conversations,
    activeConversationId: safeId,
    messages: readConversationMessages(safeId)
  };
}

export function deleteConversationAndSelectNext(conversationId: string): ChatStateSnapshot {
  const index = readIndex();
  const remaining = index.conversations.filter((item) => item.id !== conversationId);
  window.localStorage.removeItem(conversationKey(conversationId));

  if (remaining.length === 0) {
    const created = createEmptyConversation();
    writeConversationMessages(created.meta.id, []);
    writeIndex({
      activeConversationId: created.meta.id,
      conversations: [created.meta]
    });
    return {
      conversations: [created.meta],
      activeConversationId: created.meta.id,
      messages: []
    };
  }

  const conversations = sortConversations(remaining);
  const activeConversationId =
    index.activeConversationId === conversationId
      ? conversations[0].id
      : (index.activeConversationId ?? conversations[0].id);

  writeIndex({
    activeConversationId,
    conversations
  });

  return {
    conversations,
    activeConversationId,
    messages: readConversationMessages(activeConversationId)
  };
}

export function saveConversationMessages(
  conversationId: string,
  messages: StoredChatMessage[]
): ChatConversationMeta[] {
  const trimmedMessages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  const index = readIndex();
  const now = Date.now();
  const existing = index.conversations.find((item) => item.id === conversationId);
  const updatedMeta: ChatConversationMeta = {
    id: conversationId,
    title: deriveTitle(trimmedMessages),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messageCount: trimmedMessages.length
  };

  const conversations = sortConversations([
    updatedMeta,
    ...index.conversations.filter((item) => item.id !== conversationId)
  ]);

  writeConversationMessages(conversationId, trimmedMessages);
  writeIndex({
    activeConversationId: conversationId,
    conversations
  });

  return conversations;
}
