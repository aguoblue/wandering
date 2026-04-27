import type { TravelPlan } from './mockPlans';

const GENERATED_PLANS_KEY = 'figma_generated_travel_plans_v1';
const PLAN_CONVERSATION_LINKS_KEY = 'figma_plan_conversation_links_v2';
const PLAN_ACTIVITY_NOTES_KEY = 'figma_plan_activity_notes_v1';
const PLAN_USER_STATES_KEY = 'figma_plan_user_states_v1';
const USER_VISITED_PLACES_KEY = 'figma_user_visited_places_v1';
const PLANS_MIGRATED_KEY = 'figma_plans_migrated_to_backend_v1';

interface PlanConversationLinkRecord {
  conversationIds: string[];
}

type PlanConversationLinksMap = Record<string, PlanConversationLinkRecord>;
type PlanActivityNotesMap = Record<string, Record<string, string>>;

export interface PlanUserState {
  status: 'planned' | 'completed';
  completedAt?: number;
  updatedAt?: number;
}

export interface VisitedPlace {
  placeKey: string;
  title: string;
  coordinates: [number, number];
  sourcePlanIds: string[];
  sourceActivityIds: string[];
  visitedAt: number;
  visitCount: number;
}

type PlanUserStatesMap = Record<string, PlanUserState>;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as { error?: string; detail?: string };
  return record.error || record.detail || fallback;
}

async function readJsonOrThrow(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(normalizeError(data, fallback));
  }
  return data;
}

export function loadGeneratedPlans(): TravelPlan[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(GENERATED_PLANS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('读取本地 AI 计划失败：', error);
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

function loadPlanActivityNotesMap(): PlanActivityNotesMap {
  if (!canUseStorage()) return {};

  try {
    const raw = window.localStorage.getItem(PLAN_ACTIVITY_NOTES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PlanActivityNotesMap;
  } catch (error) {
    console.warn('读取本地活动备注失败：', error);
    return {};
  }
}

function savePlanActivityNotesMap(nextMap: PlanActivityNotesMap) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PLAN_ACTIVITY_NOTES_KEY, JSON.stringify(nextMap));
}

function loadPlanUserStatesMap(): PlanUserStatesMap {
  if (!canUseStorage()) return {};

  try {
    const raw = window.localStorage.getItem(PLAN_USER_STATES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as PlanUserStatesMap;
  } catch (error) {
    console.warn('读取本地计划状态失败：', error);
    return {};
  }
}

function savePlanUserStatesMap(nextMap: PlanUserStatesMap) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(PLAN_USER_STATES_KEY, JSON.stringify(nextMap));
}

function loadVisitedPlaces(): VisitedPlace[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(USER_VISITED_PLACES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('读取本地用户足迹失败：', error);
    return [];
  }
}

function saveVisitedPlaces(places: VisitedPlace[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(USER_VISITED_PLACES_KEY, JSON.stringify(places));
}

function normalizePlaceTitle(title: string) {
  return title
    .replace(/\s+/g, '')
    .replace(/[()（）【】\[\]]/g, '')
    .toLowerCase();
}

function toPlaceKey(title: string, coordinates: [number, number]) {
  const [lng, lat] = coordinates;
  return `${normalizePlaceTitle(title)}:${lng.toFixed(4)},${lat.toFixed(4)}`;
}

async function importLocalPlansIfNeeded() {
  if (!canUseStorage()) return;
  if (window.localStorage.getItem(PLANS_MIGRATED_KEY) === '1') return;

  const localPlans = loadGeneratedPlans();
  if (localPlans.length === 0) {
    window.localStorage.setItem(PLANS_MIGRATED_KEY, '1');
    return;
  }

  try {
    const response = await fetch('/api/plans/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(localPlans.map((plan) => ({ plan })))
    });
    await readJsonOrThrow(response, '迁移本地计划失败');
    window.localStorage.setItem(PLANS_MIGRATED_KEY, '1');
  } catch (error) {
    console.warn('迁移本地计划到后端失败，继续使用后端/本地兜底：', error);
  }
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

export async function getAllPlans(): Promise<TravelPlan[]> {
  await importLocalPlansIfNeeded();

  try {
    const response = await fetch('/api/plans');
    const data = (await readJsonOrThrow(response, '加载计划失败')) as { plans?: TravelPlan[] };
    const plans = Array.isArray(data.plans) ? data.plans : [];
    saveGeneratedPlans(plans);
    return plans;
  } catch (error) {
    console.warn('加载后端计划失败，使用本地缓存：', error);
    return loadGeneratedPlans();
  }
}

export async function getPlanById(planId: string): Promise<TravelPlan | null> {
  if (!planId) return null;

  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}`);
    const data = (await readJsonOrThrow(response, '加载计划详情失败')) as { plan?: TravelPlan };
    return data.plan ?? null;
  } catch (error) {
    console.warn('加载后端计划详情失败，使用本地缓存：', error);
    return loadGeneratedPlans().find((plan) => plan.id === planId) ?? null;
  }
}

export async function upsertGeneratedPlan(plan: TravelPlan): Promise<TravelPlan[]> {
  try {
    const response = await fetch('/api/plans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ plan })
    });
    await readJsonOrThrow(response, '保存计划失败');
    return getAllPlans();
  } catch (error) {
    console.warn('保存后端计划失败，写入本地缓存：', error);
    const current = loadGeneratedPlans();
    const next = [plan, ...current.filter((item) => item.id !== plan.id)];
    saveGeneratedPlans(next);
    return next;
  }
}

export async function deleteGeneratedPlan(planId: string): Promise<TravelPlan[]> {
  if (!planId) return getAllPlans();

  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}`, {
      method: 'DELETE'
    });
    await readJsonOrThrow(response, '删除计划失败');
    return getAllPlans();
  } catch (error) {
    console.warn('删除后端计划失败，仅删除本地缓存：', error);
  }

  const current = loadGeneratedPlans();
  const next = current.filter((item) => item.id !== planId);
  saveGeneratedPlans(next);

  const currentMap = loadPlanConversationLinksMap();
  if (currentMap[planId]) {
    delete currentMap[planId];
    savePlanConversationLinksMap(currentMap);
  }

  const notesMap = loadPlanActivityNotesMap();
  if (notesMap[planId]) {
    delete notesMap[planId];
    savePlanActivityNotesMap(notesMap);
  }

  const statesMap = loadPlanUserStatesMap();
  if (statesMap[planId]) {
    delete statesMap[planId];
    savePlanUserStatesMap(statesMap);
  }

  return next;
}

export async function getPlanActivityNotes(planId: string) {
  if (!planId) return {} as Record<string, string>;

  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/activity-notes`);
    const data = (await readJsonOrThrow(response, '加载活动备注失败')) as { notes?: Record<string, string> };
    return data.notes ?? {};
  } catch (error) {
    console.warn('加载后端活动备注失败，使用本地缓存：', error);
    const currentMap = loadPlanActivityNotesMap();
    return currentMap[planId] || {};
  }
}

export async function savePlanActivityNote(planId: string, activityId: string, note: string) {
  if (!planId || !activityId) return getPlanActivityNotes(planId);

  try {
    const response = await fetch(
      `/api/plans/${encodeURIComponent(planId)}/activity-notes/${encodeURIComponent(activityId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ note })
      }
    );
    const data = (await readJsonOrThrow(response, '保存活动备注失败')) as { notes?: Record<string, string> };
    return data.notes ?? {};
  } catch (error) {
    console.warn('保存后端活动备注失败，写入本地缓存：', error);
  }

  const currentMap = loadPlanActivityNotesMap();
  const currentNotes = currentMap[planId] || {};
  const nextNote = note.trim();
  const nextNotes = { ...currentNotes };

  if (nextNote) {
    nextNotes[activityId] = nextNote;
  } else {
    delete nextNotes[activityId];
  }

  currentMap[planId] = nextNotes;
  savePlanActivityNotesMap(currentMap);
  return nextNotes;
}

export async function getPlanUserState(planId: string): Promise<PlanUserState> {
  if (!planId) return { status: 'planned' };

  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}/state`);
    const data = (await readJsonOrThrow(response, '加载计划状态失败')) as { state?: PlanUserState };
    return data.state ?? { status: 'planned' };
  } catch (error) {
    console.warn('加载后端计划状态失败，使用本地缓存：', error);
    const currentMap = loadPlanUserStatesMap();
    return currentMap[planId] || { status: 'planned' };
  }
}

export async function getPlanUserStates(planIds: string[]) {
  const entries = await Promise.all(
    planIds.map(async (planId) => [planId, await getPlanUserState(planId)] as const)
  );
  return Object.fromEntries(entries) as Record<string, PlanUserState>;
}

export async function getVisitedPlaces() {
  try {
    const response = await fetch('/api/visited-places');
    const data = (await readJsonOrThrow(response, '加载用户足迹失败')) as { visitedPlaces?: VisitedPlace[] };
    return Array.isArray(data.visitedPlaces) ? data.visitedPlaces : [];
  } catch (error) {
    console.warn('加载后端用户足迹失败，使用本地缓存：', error);
    return loadVisitedPlaces();
  }
}

export async function markPlanCompleted(plan: TravelPlan) {
  try {
    await upsertGeneratedPlan(plan);
    const response = await fetch(`/api/plans/${encodeURIComponent(plan.id)}/complete`, {
      method: 'POST'
    });
    const data = (await readJsonOrThrow(response, '标记计划完成失败')) as {
      state?: PlanUserState;
      visitedPlaces?: VisitedPlace[];
    };
    return {
      planState: data.state ?? { status: 'completed', completedAt: Date.now() },
      visitedPlaces: data.visitedPlaces ?? []
    };
  } catch (error) {
    console.warn('后端标记计划完成失败，写入本地缓存：', error);
  }

  const completedAt = Date.now();
  const statesMap = loadPlanUserStatesMap();
  statesMap[plan.id] = {
    status: 'completed',
    completedAt
  };
  savePlanUserStatesMap(statesMap);

  const placesByKey = new Map(loadVisitedPlaces().map((place) => [place.placeKey, place]));

  for (const day of plan.days) {
    for (const activity of day.activities) {
      const coordinates = activity.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) continue;
      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const normalizedCoordinates: [number, number] = [lng, lat];
      const placeKey = toPlaceKey(activity.title, normalizedCoordinates);
      const currentPlace = placesByKey.get(placeKey);

      if (currentPlace) {
        placesByKey.set(placeKey, {
          ...currentPlace,
          sourcePlanIds: Array.from(new Set([...currentPlace.sourcePlanIds, plan.id])),
          sourceActivityIds: Array.from(new Set([...currentPlace.sourceActivityIds, activity.id])),
          visitedAt: Math.max(currentPlace.visitedAt, completedAt),
          visitCount: currentPlace.sourcePlanIds.includes(plan.id)
            ? currentPlace.visitCount
            : currentPlace.visitCount + 1
        });
      } else {
        placesByKey.set(placeKey, {
          placeKey,
          title: activity.title,
          coordinates: normalizedCoordinates,
          sourcePlanIds: [plan.id],
          sourceActivityIds: [activity.id],
          visitedAt: completedAt,
          visitCount: 1
        });
      }
    }
  }

  const nextPlaces = Array.from(placesByKey.values()).sort((a, b) => b.visitedAt - a.visitedAt);
  saveVisitedPlaces(nextPlaces);

  return {
    planState: statesMap[plan.id],
    visitedPlaces: nextPlaces
  };
}
