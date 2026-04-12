import http from 'node:http';

const AI_PLAN_SYSTEM_PROMPT = `你是一个“旅行数据生成器”，只负责生成可直接用于前端渲染的结构化数据。

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
14. 文案必须是中文。`;

function buildAiPlanUserPrompt(input) {
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

const PORT = Number(process.env.AI_SERVER_PORT || 8787);
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL_NAME = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
const BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(JSON.stringify(data));
}

function extractJsonArray(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Model did not return a JSON array');
  }
  const payload = text.slice(start, end + 1);
  return JSON.parse(payload);
}

function validatePlans(plans) {
  if (!Array.isArray(plans)) {
    throw new Error('Output must be an array');
  }

  if (plans.length === 0) {
    throw new Error('Output array is empty');
  }

  for (const plan of plans) {
    if (!plan || typeof plan !== 'object') {
      throw new Error('Invalid plan object');
    }
    if (!plan.id || !plan.name || !Array.isArray(plan.days)) {
      throw new Error('Plan is missing required fields');
    }
  }
}

async function requestAnthropic({ systemPrompt, userPrompt }) {
  if (!API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is missing');
  }

  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      max_tokens: 2600,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const text = Array.isArray(data.content)
    ? data.content.find((item) => item.type === 'text')?.text || ''
    : '';

  if (!text) {
    throw new Error('No text returned from model');
  }

  return text;
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      hasApiKey: Boolean(API_KEY),
      model: MODEL_NAME
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/ai/generate-plan') {
    try {
      const body = await readJsonBody(req);
      const city = typeof body.city === 'string' && body.city.trim() ? body.city.trim() : '深圳';
      const days = Number(body.days) > 0 ? Number(body.days) : 1;
      const activitiesPerDay = Number(body.activitiesPerDay) > 0 ? Number(body.activitiesPerDay) : 4;
      const startDate = typeof body.startDate === 'string' && body.startDate.trim() ? body.startDate.trim() : '2026-05-01';
      const budgetRange = typeof body.budgetRange === 'string' && body.budgetRange.trim() ? body.budgetRange.trim() : '¥700-2200';
      const style = typeof body.style === 'string' && body.style.trim() ? body.style.trim() : '城市漫游、美食、海滨、拍照、轻松节奏';

      const userPrompt = buildAiPlanUserPrompt({
        city,
        days,
        activitiesPerDay,
        startDate,
        budgetRange,
        style
      });

      const modelText = await requestAnthropic({
        systemPrompt: AI_PLAN_SYSTEM_PROMPT,
        userPrompt
      });

      const plans = extractJsonArray(modelText);
      validatePlans(plans);

      sendJson(res, 200, {
        plans,
        usage: {
          model: MODEL_NAME
        }
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`[ai-server] listening on http://localhost:${PORT}`);
});
