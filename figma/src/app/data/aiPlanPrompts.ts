export const AI_PLAN_SYSTEM_PROMPT = `你是一个“旅行数据生成器”，只负责生成可直接用于前端渲染的结构化数据。

目标文件结构（必须严格匹配）：
- 顶层是 TravelPlan[] 数组
- 每个 plan 字段：
  id: string
  name: string
  tags: string[]
  duration: string
  highlight: string
  walkingIntensity: string
  budget: string
  image: string
  days: Day[]
  destination: string

- Day 字段：
  day: number
  date: string (YYYY-MM-DD)
  activities: Activity[]

- Activity 字段：
  id: string
  time: string (HH:mm-HH:mm)
  period: string（只能是：上午 / 中午 / 下午 / 晚上）
  title: string
  description: string
  reason: string
  duration: string
  transport: string
  alternatives: string[]
  coordinates: [number, number]

关键约束（必须满足）：
1. 只输出 JSON 数组：以 "[" 开始，以 "]" 结束；不要输出 Markdown，不要解释，不要代码围栏。
2. 必须是合法 JSON（双引号字符串、无注释、无尾随逗号）。
3. coordinates 顺序必须是 [纬度, 经度]（非常重要，不是 [经度, 纬度]）。
4. period 只能使用：上午、中午、下午、晚上；不要出现其他词。
5. time 必须与 period 语义一致。
6. 每个 day 的 activities 按 time 升序排列，不重叠。
7. day 必须从 1 连续递增；date 也按天连续递增。
8. activity.id 在同一个 plan 内唯一，格式建议 "{day}-{index}"。
9. tags 建议 3 个，简短中文词。
10. budget 格式：¥数字-数字，例如 ¥800-1200。
11. walkingIntensity 使用以下之一：低 (5-8km/天) / 中 (8-12km/天) / 中高 (10-15km/天)。
12. image 使用可访问图片 URL（可用 unsplash）。
13. alternatives 至少 2 个备选项。
14. 文案必须是中文。

质量要求：
- 路线尽量地理连贯，同一天不要跨城跳跃。
- transport 要现实可执行。
- description 与 reason 不要重复。`;

export interface BuildAiPromptInput {
  city: string;
  days: number;
  activitiesPerDay: number;
  startDate: string;
  budgetRange: string;
  style: string;
}

export function buildAiPlanUserPrompt(input: BuildAiPromptInput) {
  const { city, days, activitiesPerDay, startDate, budgetRange, style } = input;

  return `请按既定 schema 生成 1 条 TravelPlan 数据。

要求：
- 城市范围：${city}
- 每条 plan 天数：${days}天
- 每天活动数：${activitiesPerDay}个
- 风格偏好：${style}
- 预算区间：${budgetRange}
- 出行节奏：低 或 中（不要中高）
- 开始日期：${startDate}
- 语言：中文简体
- 输出：仅 JSON 数组，不要任何解释文本

额外要求：
- destination 必须与 plan 内容城市一致
- name 要有吸引力且不重复
- highlight 一句话概括卖点
- 避免生成重复 POI 组合
- coordinates 必须是 [纬度, 经度]
- period 仅可用：上午、中午、下午、晚上`;
}
