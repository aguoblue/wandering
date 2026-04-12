import { mockPlans, TravelPlan } from './mockPlans';

const GENERATED_PLANS_KEY = 'figma_generated_travel_plans_v1';

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

export function getAllPlans(): TravelPlan[] {
  return [...mockPlans, ...loadGeneratedPlans()];
}

export function upsertGeneratedPlan(plan: TravelPlan): TravelPlan[] {
  const current = loadGeneratedPlans();
  const next = [plan, ...current.filter((item) => item.id !== plan.id)];
  saveGeneratedPlans(next);
  return next;
}
