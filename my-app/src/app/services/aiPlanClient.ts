import { TravelPlan } from '../data/mockPlans';

export interface GeneratePlanInput {
  city: string;
  days?: number;
  activitiesPerDay?: number;
  startDate?: string;
  style?: string;
}

interface GeneratePlanResponse {
  plans: TravelPlan[];
  usage?: {
    model?: string;
  };
}

export async function generatePlanWithAi(input: GeneratePlanInput) {
  const response = await fetch('/api/ai/generate-plan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'AI 生成失败');
  }

  const data = (await response.json()) as GeneratePlanResponse;
  if (!data?.plans || !Array.isArray(data.plans) || data.plans.length === 0) {
    throw new Error('AI 返回了空计划');
  }

  return data;
}
