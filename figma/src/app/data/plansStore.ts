import { TravelPlan } from './mockPlans';

const GENERATED_PLANS_KEY = 'figma_generated_travel_plans_v1';
const PLAN_CONVERSATION_LINKS_KEY = 'figma_plan_conversation_links_v2';

interface PlanConversationLinkRecord {
  conversationIds: string[];
}

type PlanConversationLinksMap = Record<string, PlanConversationLinkRecord>;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadGeneratedPlans(): TravelPlan[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(GENERATED_PLANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('读取 AI 计划失败：', error);
    return [];
  }
}

export function saveGeneratedPlans(plans: TravelPlan[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(GENERATED_PLANS_KEY, JSON.stringify(plans));
}

function loadPlanConversationLinksMap(): PlanConversationLinksMap {
  if (!canUseStorage()) return {};

  try {
    const raw = window.localStorage.getItem(PLAN_CONVERSATION_LINKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PlanConversationLinksMap;
  } catch (error) {
    console.warn('读取计划会话关联失败：', error);
    return {};
  }
}

function savePlanConversationLinksMap(nextMap: PlanConversationLinksMap) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PLAN_CONVERSATION_LINKS_KEY, JSON.stringify(nextMap));
}

export function getPlanConversationIds(planId: string) {
  if (!planId) return [] as string[];
  const currentMap = loadPlanConversationLinksMap();
  const record = currentMap[planId];
  if (!record) return [] as string[];
  return Array.from(new Set((record.conversationIds || []).filter(Boolean)));
}

export function getAllLinkedConversationIds() {
  const currentMap = loadPlanConversationLinksMap();
  const ids = new Set<string>();
  for (const record of Object.values(currentMap)) {
    for (const conversationId of record.conversationIds || []) {
      if (conversationId) ids.add(conversationId);
    }
  }
  return Array.from(ids);
}

export function linkConversationToPlan(planId: string, conversationId: string) {
  if (!planId || !conversationId) return;
  const currentMap = loadPlanConversationLinksMap();
  const currentRecord = currentMap[planId] || {
    conversationIds: []
  };
  const nextConversationIds = Array.from(new Set([...currentRecord.conversationIds, conversationId]));

  currentMap[planId] = {
    conversationIds: nextConversationIds
  };
  savePlanConversationLinksMap(currentMap);
}

export function getAllPlans(): TravelPlan[] {
  return loadGeneratedPlans();
}

export function upsertGeneratedPlan(plan: TravelPlan): TravelPlan[] {
  const current = loadGeneratedPlans();
  const next = [plan, ...current.filter((item) => item.id !== plan.id)];
  saveGeneratedPlans(next);
  return next;
}
