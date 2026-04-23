# 20260420 主应用提升到仓库根目录并移除 my-app

1. **主应用目录扁平化**：将原 `my-app/` 下的 Vite + React + 高德地图主应用迁移到仓库根目录，主入口改为根目录 `index.html`、`src/`、`public/`、`package.json` 等文件。
2. **移除旧目录**：删除 `my-app/` 目录及其遗留构建产物、依赖目录和说明文件，避免后续开发继续在旧路径下操作。
3. **仓库说明同步更新**：更新 `README.md` 与 `AGENTS.md` 中的运行、构建、环境变量和目录说明，使文档与新的根目录结构保持一致。
4. **保留旧 demo 备份**：原根目录独立 demo 页面改名为 `standalone-demo.html`，避免覆盖时丢失。

# 20260420 figma 后端高德 Key 配置分离（优先 AMAP_WEB_KEY）

1. **后端 Key 读取顺序升级**：`figma/server/ai_server.py` 新增 `get_amap_key_with_source`，后端调用高德 REST API 时优先读取 `AMAP_WEB_KEY`（env/.env），其次 `AMAP_KEY`，最后才回退 `VITE_AMAP_KEY`。
2. **启动可观测性增强**：启动日志新增 `has_amap_key` 与 `amap_key_source`，若回退到 `VITE_AMAP_KEY` 会给出告警，提示可能触发 `USERKEY_PLAT_NOMATCH`。
3. **环境文件补位**：`figma/.env` 新增 `AMAP_WEB_KEY=` 配置位，便于独立配置后端专用 Key。
4. **生成计划 JSON 容错补齐**：`generate_plan_from_draft` 新增“解析失败后二次重试 + `JSON_ARRAY_REPAIR_SYSTEM_PROMPT` 修复回退”，避免因模型偶发输出非法 JSON 直接导致生成失败。

# 20260420 figma 高德匹配调试日志增强与地点类型约束

1. **新增高德匹配调试开关**：`figma/server/ai_server.py` 新增环境变量 `AI_SERVER_LOG_AMAP_MATCH`；开启后会打印高德文本检索/周边检索的关键参数、返回元信息和 Top 候选摘要。
2. **新增候选打分明细日志**：在 `search_amap_poi_coordinates` 中新增 `amap match selected/rejected` 日志，输出每次匹配的 `min_score`、最终命中与候选分数列表，便于定位“为什么命中了错误 POI”。
3. **地点类型约束加强**：若关键词包含“公园/商场/艺术中心/老街”等类型词，而候选名称不含对应类型，会显著降分，减少“滨海公园误命中购物中心”问题。
4. **匹配策略调整为文本优先**：`search_amap_poi_coordinates` 改为先用 `place/text`（严格/放宽城市）决策；仅在文本候选不达阈值时，才回退到 `place/around`，避免被不可靠初始坐标带偏。
5. **补点失败根因修复**：`clean_activity_keyword` 修复“`深圳·太子湾滨海公园` 被清洗成 `深圳`”的问题，改为优先提取 `·` 后主地点名；同时避免把仅城市名作为候选关键词。
6. **高德请求异常可观测**：`request_amap_json` 新增失败与非成功状态日志（脱敏 `key`），便于快速定位“接口失败/权限问题/返回空”的真实原因。
7. **复刻攻略同条消息漏判修复**：`merge_generation_mode_from_recent_context` 优先从当前 `user_message` 提取 `referenceGuide`，避免“同一条消息里同时发‘复刻要求+攻略正文’时未进入 `replicate_guide`”的问题。

# 20260420 figma 对话空流式回复兜底与复刻攻略默认天数

1. **空流式回复自动重试**：`figma/server/ai_server.py` 在 `/api/conversations/{id}/chat/stream` 中新增“流式为空 -> 同 prompt 非流式重试”逻辑，重试成功则直接回填消息，减少“我这次没有成功生成回复内容，请重试。”的暴露概率。
2. **复刻攻略不再被天数阻塞**：`route_conversation_step3` 对 `generationMode=replicate_guide` 且 `days` 缺失的场景默认补 `days=1`，避免用户给了完整攻略后仍被追问“玩几天”。

# 20260420 figma 高德补点改为候选打分，减少景点错位

1. **补点策略升级**：`figma/server/ai_server.py` 的 `search_amap_poi_coordinates` 从“返回第一个 POI”改为“对候选 POI 打分后选择最高分”，综合 `title/描述/备选项` 关键词、目的地命中和 POI 类型匹配。
2. **泛化词降权**：新增 `GENERIC_ACTIVITY_TOKENS`（如“漫步/打卡/夜景/美食”等）与最低分阈值，避免“抽象活动词”把坐标误补到不相关地点。
3. **可观测性增强**：补点成功日志新增 `score` 字段，便于排查“为什么选了这个 POI”。
4. **检索范围扩大**：新增“周边检索 + 严格城市检索 + 放宽城市检索”三路候选合并，优先尽量命中真实 POI，再由打分筛选最佳结果。
5. **利用原始坐标做兜底定位**：若活动已有初始坐标，会先走高德 `place/around` 在该点 8km 范围内检索同名候选，提高“同名不同区”场景下的命中率。
6. **地点名全称约束**：生成与更新提示词新增 `activity.title` 约束，要求使用“城市·地点全称”；后端新增 `normalize_activity_titles_with_destination` 做二次标准化，降低简称/泛化标题导致的 POI 匹配失败。

# 20260420 figma 计划列表移除 mock 数据源

1. **计划聚合改为仅真实数据**：`figma/src/app/data/plansStore.ts` 的 `getAllPlans` 不再拼接 `mockPlans`，仅返回 `localStorage` 中的 `figma_generated_travel_plans_v1` 数据。
2. **mock 类型保留**：仍复用 `mockPlans.ts` 中的 `TravelPlan` 类型定义，避免影响现有组件类型约束。

# 20260420 figma 计划会话改为“仅计划页新建才绑定”

1. **首页对话不再自动绑定计划**：`figma/src/app/components/TravelChatPanel.tsx` 在首页模式收到 `plan` 事件时，仅 `upsertGeneratedPlan` 存计划，不再把“生成计划的首页会话”回链到计划。
2. **计划页会话绑定范围收敛**：进入计划详情页后，会话列表仅展示该计划页内新建并绑定过的会话；不再默认带入历史“来源生成会话”。
3. **允许一会话生成多计划**：计划页会话中如果再次生成新计划，会把“新计划ID -> 当前会话ID”建立关联，支持一个会话后续关联多个计划。
4. **本地关联表版本升级**：`figma/src/app/data/plansStore.ts` 将键升级为 `figma_plan_conversation_links_v2`，并简化结构为 `planId -> conversationIds[]`，清除旧版“sourceConversation”语义。
5. **构建验证**：`cd figma && npm run build` 通过。
6. **计划会话首页隐藏**：`figma/src/app/components/TravelChatPanel.tsx` 在首页模式会过滤掉所有已绑定到任意计划的会话；新增 `figma/src/app/data/plansStore.ts#getAllLinkedConversationIds` 供过滤使用，确保“计划页新开的会话仅在对应计划页可见”。
7. **计划上下文消息显示修复**：`figma/src/app/components/TravelChatPanel.tsx` 新增计划模式用户消息展示清洗（仅显示“用户的新问题”），避免把注入的计划摘要原文展示在聊天气泡里。
8. **新会话发送后被重置修复**：`TravelChatPanel` 刷新会话时显式传入最新 `idsOverride`，避免因状态异步导致刚创建的计划会话被过滤掉并误回到“新建对话”空态。
9. **首页初始化漏过滤修复**：`TravelChatPanel` 初始化会话列表时，首页模式改为复用 `getFilteredConversations(list)`，避免首次进入首页时把计划私有会话展示出来。
10. **计划上下文改为隐藏字段**：前端 `sendConversationMessageStream` 新增 `planContext` 入参并单独传输；`TravelChatPanel` 计划页首条消息仅提交用户原文作为 `message`，计划摘要走 `planContext`。
11. **会话标题回归真实用户输入**：后端 `ConversationChatInput` 新增可选 `planContext`，仅用于模型 `system_prompt` 增强，不写入消息表；因此标题提取重新基于用户真实首条消息生成。
12. **计划页对话支持“更新当前计划”闭环**：`ConversationChatInput` 新增 `targetPlanId/currentPlan`；后端新增 `update_plan_from_existing`，命中调整意图后返回 `type=plan_update` SSE 事件（包含更新后的完整计划）。
13. **详情页左侧实时刷新**：前端 `chatClient` 新增 `plan_update` 事件解析；`TravelChatPanel` 收到后执行 `upsertGeneratedPlan(plan)` 并触发 `onPlanGenerated`，计划详情左侧行程/地图可立即显示更新内容。
14. **新建会话自动聚焦输入框**：`TravelChatPanel` 新增输入框 `ref` 与 `focusInput`，点击“新建”及进入默认新会话态后，会自动将光标定位到文本框，支持立即输入。
15. **计划页每轮携带计划上下文**：`TravelChatPanel` 在计划页发送消息时，不再仅首条携带 `planContext`，而是每轮都传 `planContext + targetPlanId + currentPlan`，确保后续对话持续感知当前计划。
16. **计划编辑改为“先判意图再更新”**：`ai_server.py` 新增 `detect_plan_edit_intent`，在计划页请求中先判断 `update_plan/chat`；命中 `update_plan` 才走结构化整计划更新，否则走普通对话回复。
17. **计划更新 JSON 失败自动重试**：`update_plan_from_existing` 对 AI 返回的 JSON 解析增加二次重试提示，降低因格式不合法导致的更新失败概率。
18. **plan_update 事件补充意图字段**：后端 `plan_update` SSE 事件新增 `intent=update_plan`，明确表示本轮为计划结构化修改回执。
19. **计划修改提示词升级**：`ai_server.py` 新增 `AI_PLAN_UPDATE_SYSTEM_PROMPT`，将“修改计划”与“生成计划”拆分为独立系统提示词，强调“基于当前计划修改并返回完整合法 JSON”。
20. **修改结果 JSON 修复回退**：`update_plan_from_existing` 在首次解析失败后，新增 `JSON_ARRAY_REPAIR_SYSTEM_PROMPT` 进行自动修复再解析，降低 `JSONDecodeError` 失败率。
21. **计划页问答注入完整计划 JSON**：`ai_server.py` 在计划页请求（携带 `currentPlan`）的普通问答分支中，将完整计划 JSON 注入系统上下文，优先用于回答“具体时间/地点/活动安排”等细节问题。

# 20260420 figma 计划详情页接入右侧 AI 对话与计划关联会话

1. **计划-会话关联存储**：`figma/src/app/data/plansStore.ts` 新增本地关联表（`figma_plan_conversation_links_v1`），支持记录 `plan -> sourceConversationId + conversationIds`，并提供 `getPlanConversationIds/getPlanSourceConversationId/linkConversationToPlan` 能力。
2. **对话组件支持计划上下文模式**：`figma/src/app/components/TravelChatPanel.tsx` 新增 `relatedPlan` 参数；在计划详情页中会话列表仅展示该计划关联会话，且每次进入默认是新对话模式。
3. **新会话自动携带计划记忆**：在计划模式下首次发送会自动附带计划摘要（计划名、目的地、天数与日程概览）到请求体，确保“新开对话也理解当前计划”。
4. **生成与编辑自动回链**：对话中产出 `plan` 事件时，`upsertGeneratedPlan` 会同时写入会话关联；计划模式下新建会话发送后也会自动绑定到当前计划。
5. **详情页右侧接入 AI 对话框**：`figma/src/app/pages/PlanDetailPage.tsx` 改为左右布局（左侧行程/地图，右侧 `TravelChatPanel`），满足“点进计划后即可继续/新开对话”。
6. **构建验证**：`cd figma && npm run build` 通过。

# 20260420 figma 会话改为 AI 结构化抽取（意图+参数）两段式

1. **第一段 JSON 抽取上线**：`figma/server/ai_server.py` 新增 `STRUCTURED_EXTRACTION_SYSTEM_PROMPT` 与 `extract_turn_structured_by_ai`，由模型先输出结构化结果（`intent/confidence/should_exit_plan_flow/slots_patch`）。
2. **参数回填改为结构化补丁**：新增 `parse_first_json_object`、`sanitize_slots_patch`、`normalize_budget_range`，对模型 JSON 做严格清洗后再用于 `plan_draft` 合并，支持单值预算自动转 `¥X-X`。
3. **状态机接入 AI 抽取结果**：`route_conversation_step3` 支持外部传入 `extracted_slots` 与 `should_exit_plan`；会话入口优先使用 AI 抽取，失败时回退规则识别，保证不中断。
4. **可观测性增强**：新增 `conversation structured extraction` 日志，记录抽取来源、意图、置信度、槽位补丁和原始 JSON，便于排查“参数未回填”问题。

# 20260420 figma 计划状态回复改为 AI 自然引导（流式）

1. **状态识别后不再固定模板回复**：`figma/server/ai_server.py` 在命中 `route_conversation_step3` 后，改为将 `意图/状态流转/已收集槽位/缺失字段` 组装成上下文，交给模型生成自然回复并流式返回。
2. **新增计划收集专用系统提示词**：新增 `PLAN_COLLECTION_SYSTEM_PROMPT`，强调“先回应用户当前问题，再顺势追问 1-2 个关键缺失项”，避免机械问表单。
3. **保留规则兜底**：状态机仍负责 `state/plan_draft/pending_action` 的确定性更新；若模型流式失败且尚未产出文本，会回退到原规则回复，保证不中断。

# 20260420 figma 计划流转可中断与关键词误判修复

1. **支持中途切回普通聊天**：`figma/server/ai_server.py` 新增 `should_exit_plan_flow`，在 `collecting_plan_slots / awaiting_confirm_generate` 阶段识别“算了、先聊聊、不做计划了”等表达，意图判定为 `reject` 并回退到 `normal_chat`。
2. **修复“聊天”误判为补槽位**：新增 `should_update_plan_slots`，把槽位识别改为正则模式（如“3天/两天/预算/风格”等），不再用单字 `天/日` 直接命中，避免“聊天”被误判为 `update_slots`。
3. **状态机 reject 范围扩大**：`route_conversation_step3` 中 `reject` 由仅在 `awaiting_confirm_generate` 生效，扩展为在 `collecting_plan_slots` 也生效，回复文案改为“先切回普通聊天”。

# 20260420 figma AI 日志按启动归档（分钟后缀）

1. **启动归档旧日志**：`figma/server/ai_server.py` 在日志初始化时，若存在 `ai-server.log`，会先重命名为 `ai-server.log.YYYYMMDDHHMM`（示例：`ai-server.log.202604200955`），然后再创建新的 `ai-server.log`。
2. **同分钟重启防覆盖**：若同一分钟内多次重启导致目标归档名重复，会自动追加序号（如 `.1`、`.2`）避免覆盖。
3. **现有滚动策略保留**：归档后当前运行仍使用 `RotatingFileHandler` 的大小轮转（2MB，保留 5 份）。

# 20260420 figma 对话流接入真实计划生成与 plan 事件

1. **后端接入真实计划生成**：`figma/server/ai_server.py` 新增 `AI_PLAN_SYSTEM_PROMPT`、`generate_plan_from_draft` 等函数，在会话处于 `awaiting_confirm_generate` 且用户 `confirm` 时，按 `plan_draft` 实际调用模型生成 `TravelPlan`。
2. **SSE 协议扩展**：`/api/conversations/{id}/chat/stream` 新增 `type=plan` 事件，事件中同时返回 `plan` 与 `assistantMessage`；并统一补充 `type=delta/done/error` 字段（保留原有 `delta/done/error` 兼容解析）。
3. **前端消费 plan 事件**：`figma/src/app/services/chatClient.ts` 新增 `onPlan` 回调；`TravelChatPanel` 收到 `plan` 后会调用 `upsertGeneratedPlan` 入库，并把 `assistantMessage` 写入当前助手气泡。
4. **列表页联动刷新**：`figma/src/app/pages/PlansListPage.tsx` 给 `TravelChatPanel` 传入 `onPlanGenerated`，计划生成后立即刷新列表展示。
5. **移除旧生成入口**：删除 `PlansListPage` 中“AI 生成一条计划”按钮及对应 `generatePlanWithAi` 前端调用逻辑，统一只保留“对话触发生成计划”这一条路径。

# 20260420 figma 对话状态机流转接入（第 3 步）

1. **状态机分流生效**：`figma/server/ai_server.py` 在 `/api/conversations/{id}/chat/stream` 中接入 `route_conversation_step3`。命中生成计划相关意图时，不再直接走大模型回复，而是进入参数收集/确认态分支。
2. **新增槽位处理**：新增 `extract_plan_slots_from_text`、`missing_plan_fields`、`build_slot_question` 等函数，支持从自然语言提取 `city/days/budgetRange/style/startDate`（含中文“`两天`”这类天数表达）。
3. **状态持久化**：新增 `update_conversation_context`，在会话表中持久化 `state/plan_draft/pending_action`；当参数齐全时状态进入 `awaiting_confirm_generate` 并写入 `pending_action={type: generate_plan}`。
4. **行为边界**：当前仍未执行真实计划生成，只实现“收集参数 -> 等待确认”流程；普通聊天路径保持原有模型流式回复。
5. **意图匹配修正**：`detect_intent` 从单一短语匹配升级为“动词（生成/安排/制定/规划/做）+ 名词（计划/行程/攻略）”组合判断，并补充口语正则（如“帮我生成一个计划吧”），修复口语化表达误判为 `chat` 的问题。

# 20260420 figma AI 意图识别接入（第 2 步）

1. **新增意图识别函数**：`figma/server/ai_server.py` 新增 `detect_intent(message, conversation_state)`，输出 `chat / generate_plan / confirm / reject / update_slots` 五类意图；当前只基于关键词与会话状态做轻量判断。
2. **仅记录不执行**：在 `/api/conversations/{id}/chat/stream` 入口新增 `conversation stream intent` 日志，打印 `state + intent`；不改变原有回复流程，不触发计划生成。
3. **行为保持不变**：当前阶段仍是原来的聊天流式回复链路，仅增加可观测性，便于第 3 步接入状态机前先观察真实对话意图分布。

# 20260420 figma AI 会话状态骨架（第 1 步）

1. **会话表新增字段**：`figma/server/ai_server.py` 的 `conversations` 表补充 `state`、`plan_draft`、`pending_action` 三个字段，默认值分别为 `normal_chat`、`{}`、`{}`，为后续“对话内触发生成计划”状态机做准备。
2. **兼容旧库迁移**：启动初始化时增加 `PRAGMA table_info + ALTER TABLE` 的轻量迁移逻辑，已有 `chat.db` 会自动补齐新字段，不影响现有消息数据。
3. **会话返回结构扩展**：会话元数据中新增 `state`、`planDraft`、`pendingAction` 字段（JSON 解析容错），当前阶段仅提供骨架，不改变聊天行为。

# 20260419 修正 figma server .db 被 gitignore 仍出现在 status

1. **原因**：`figma/server/**/*.db` 规则本身有效，但 `chat.db` 曾被加入版本库时，忽略规则不会对已跟踪文件生效。
2. **处理**：执行 `git rm --cached figma/server/server/data/chat.db`，从索引移除并保留本地文件；此后该路径被 `.gitignore` 正确忽略。

# 20260419 figma AI 会话流式打印发给模型的 messages

1. **`/api/conversations/{id}/chat/stream`**：在 `build_conversation_messages_for_model` 得到 `model_messages` 后增加 INFO 日志，输出条数与 `json.dumps` 完整 payload，对应下游 `client.messages.stream(..., messages=model_messages)`。

# 20260419 figma AI 会话流式开始日志字段调整

1. **`/api/conversations/{id}/chat/stream` 开始日志**：由仅记录 `user_chars`（`len(user_message)`）改为记录完整 `user_message` 正文，便于排查；需注意日志体量与敏感内容。

# 20260419 figma AI 服务日志框架补齐

1. **终端 + 文件双写日志**：`figma/server/ai_server.py` 新增基于 Python `logging` 的日志配置，启动后同时输出到终端和 `figma/server/server/logs/ai-server.log`。
2. **流式请求打点**：为 `/api/ai/chat/stream` 和 `/api/conversations/{id}/chat/stream` 增加 `request_id`、开始/完成/失败、耗时、chunk 数、回复长度等日志。
3. **可选 chunk 级调试**：支持通过环境变量 `AI_SERVER_LOG_STREAM_CHUNKS=true` 打开流式分片级别调试日志，默认关闭以避免日志过多。

# 20260419 figma AI 对话改为 SQLite 持久化

1. **后端接入数据库**：`figma/server/ai_server.py` 新增 SQLite 初始化与建表（`conversations`、`messages`），服务启动自动创建 `server/data/chat.db`。
2. **会话管理接口**：新增 `GET/POST /api/conversations`、`GET /api/conversations/{id}/messages`、`DELETE /api/conversations/{id}`，支持多会话历史管理。
3. **流式回复写库**：新增 `POST /api/conversations/{id}/chat/stream`，在流式输出时持久化 `user/assistant` 消息并更新会话标题、更新时间、消息数量。
4. **前端改为数据库驱动**：`TravelChatPanel` 与 `chatClient` 改为调用数据库会话接口，不再依赖 `localStorage` 的会话存储。

# 20260419 figma AI 对话支持本地多会话历史（第一步）

1. **本地会话存储层**：新增 `figma/src/app/data/chatStore.ts`，基于 `localStorage` 实现会话索引与消息分离存储（`index + conversation`），支持创建、切换、删除会话及消息持久化。
2. **多会话列表 UI**：`figma/src/app/components/TravelChatPanel.tsx` 新增会话列表区与“新建会话”入口，支持会话切换、删除和按最近更新时间排序展示。
3. **发送链路接入持久化**：流式回复结束后将当前会话消息写回本地，并自动更新会话标题（取首条用户消息）和消息条数，刷新页面后可恢复历史会话。

# 20260415 figma 地图搜索与选点交互优化

1. **搜索提示恢复**：在 `figma/src/app/services/amapDiscoveryClient.ts` 新增 `searchLocationSuggestions`，并在 `PlansListPage` 输入时联动显示下拉地点提示，可点击提示直接定位。
2. **搜索框回填定位位置**：统一将搜索框内容回填为最新定位地址（手动搜索、自动定位、地图右下角定位按钮、点击地图选点都会更新）。
3. **地图点击重置 Marker 逻辑**：`DiscoveryMapView` 新增地图点击事件，点击后会先清除已有 marker，再将点击点设为地图中心并渲染新 marker，同时逆地理解析地址并同步到页面状态。
4. **联想触发来源区分**：`PlansListPage` 新增“用户输入/程序回填”区分逻辑，仅用户手动输入时才请求并展示联想；程序回填地址时会清空并关闭联想面板，避免联想常驻不消失。
5. **主点定位后自动周边检索**：`DiscoveryMapView` 在主定位点确定后自动搜索周边“景点+美食”并渲染分类 marker（景点绿点/美食橙点）；点击 POI marker 会弹出详情卡片（名称、分类、地址、距离、电话）。
6. **周边列表与勾选联动**：`PlansListPage` 新增按距离排序的周边 POI 列表（支持全部/景点/美食筛选）；列表点击改为勾选态切换，勾选后地图对应 marker 高亮，再点可取消并恢复原样，地图点选与列表勾选双向同步。
7. **POI Marker 动画优化**：`DiscoveryMapView` 将周边 marker 改为按距离由近到远逐个浮现（stagger）渲染，增强探索感；勾选状态仍实时联动到 marker 高亮样式。

# 20260403 init repo
- try to use babel
- 类组件、jsx

# 20260404 my-app 地图与迭代（按发生顺序）

1. **高德地图接入**：在 `my-app` 使用 `@amap/amap-jsapi-loader` 加载 JS API 2.0；新增 `src/components/AmapMap.jsx`，在 `App.jsx` 中展示地图；通过 `.env` 配置 `VITE_AMAP_KEY`，可选 `VITE_AMAP_SECURITY_CODE`。
2. **定位**：在 `AmapMap` 中集成 `AMap.Geolocation`（比例尺、右下角定位按钮、可选自动定位 `autoLocate`）。
3. **`.gitignore`**：仓库根目录补充环境变量、系统文件等常见忽略项说明；`my-app` 侧保留 Vite 模板的 `node_modules`、`dist` 等规则。
4. **精简页面**：从 `App.jsx` 移除 `NameDisplay`、`AgeDisplay` 及其组件文件。
5. **梧桐山展示**：导出常量 `WUTONG_SHAN`（GCJ-02 坐标）；支持 `markers` 打点；`App.jsx` 以梧桐山为中心并显示标记。
6. **路径规划**：`AmapMap` 增加 `route`，使用 `AMap.Driving` / `AMap.Walking` 在地图上绘制驾车或步行路线（固定 `from` + `to`）。
7. **当前位置 → 梧桐山**：`route` 支持 `fromCurrentLocation: true` + `to`，先 `getCurrentPosition` 再规划路线；`App` 中示例改为从当前位置导航至梧桐山。
8. **注释**：为 `AmapMap.jsx` 补充文件头、步骤分段、`useEffect` 依赖说明及 Props 的 JSDoc，便于阅读结构。

# 20260404 搜索功能优化（16:05）

1. **搜索框集成**：新增 `src/components/SearchBox.jsx`，集成高德地图 `AMap.AutoComplete` 实现地点搜索自动补全功能。
2. **移除硬编码**：删除 `WUTONG_SHAN` 常量和相关硬编码标记代码，移除 `AMap.Marker` 插件的依赖。
3. **动态标记功能**：
   - `addSearchMarker` 函数负责创建和管理搜索结果的标记
   - 标记包含：名称标签、点击信息窗口、掉落动画效果
   - 搜索时地图自动调整到搜索结果位置（缩放到 16 级）
   - 支持点击标记显示详细信息（名称、地址、类型）
4. **组件优化**：
   - SearchBox 组件只负责输入框的自动补全功能，通过回调通知父组件
   - 添加了搜索标记的清理逻辑，防止内存泄漏
   - 优化了组件的依赖关系，移除了不必要的插件加载

# 20260404 搜索功能修复（17:30）

1. **修复接口不匹配问题**：
   - 移除 `AmapMap` 中多余的 `handleSearchComplete` 函数
   - 重命名 `addSearchMarker` 为 `handleSearchComplete`，统一命名
2. **修复搜索回调逻辑**：
   - `SearchBox` 在 `select` 事件中正确调用 `onSearchComplete(e.poi)` 传递 POI 数据
   - 移除错误的回调函数传递方式，改为直接使用 `window.AMap`
3. **组件通信修正**：
   - `AmapMap` 正确传递 `handleSearchComplete` 给 `SearchBox`
   - 搜索完成后自动添加标记、移动地图中心并缩放到 16 级

# 20260404 搜索功能修复（18:15）

1. **修复 AutoComplete 加载时机问题**：
   - SearchBox 组件改为独立加载 AMap API，不依赖 AmapMap 的加载状态
   - 添加 `ready` 状态控制输入框可用性，显示加载中状态
   - 使用 `autoCompleteRef` 管理 AutoComplete 实例
2. **用户体验优化**：
   - 输入框在 API 加载前显示"加载中..."并禁用
   - 加载完成后自动启用，显示"搜索地点..."占位符

# 20260404 搜索框样式优化（18:30）

1. **添加 AutoComplete 下拉列表样式**：
   - `.amap-sug-result`：下拉容器样式，白色背景、圆角、阴影
   - `.amap-sug-item`：建议项样式，hover 高亮、选中状态蓝色背景
   - 添加滚动条支持，最大高度 300px

# 20260404 搜索坐标获取修复（19:00）

1. **修复 AutoComplete 缺少坐标的问题**：
   - AutoComplete 只提供自动补全建议，不包含坐标信息
   - 添加 PlaceSearch 插件，当选择 AutoComplete 建议后，用 PlaceSearch 搜索获取详细信息和坐标
   - 如果 AutoComplete 已有坐标则直接使用，否则调用 PlaceSearch 搜索

# 20260404 路线规划功能（20:00）

1. **新增 RoutePanel 组件**：
   - 支持交通方式切换：驾车/步行/公交
   - 起点支持手动输入（AutoComplete）、定位按钮、地图选点
   - 终点显示搜索选择的地点（只读）
   - 可折叠和关闭
   - 新增 `RoutePanel.css` 样式文件
2. **AmapMap 集成路线规划**：
   - 搜索完成后信息窗口添加"规划路线"按钮
   - 点击按钮显示 RoutePanel 面板
   - 支持清除之前路线，规划新路线
   - 地图点击事件支持选点为起点
   - 起点、终点使用标准起点/终点标记图标
3. **路线规划 API**：
   - 驾车：使用 AMap.Driving
   - 步车：使用 AMap.Walking
   - 公交：使用 AMap.Transfer

# 20260404 路线交互优化（21:00）

1. **简化路线规划交互**：
   - 搜索框下方集成交通方式选择（驾车/步行/骑行/地铁）
   - 搜索完成后显示交通方式按钮
   - 选择交通方式后立即规划路线，使用当前位置作为起点
2. **SearchBox 组件更新**：
   - 添加 `travel-modes` 交通方式选择区域
   - 新增 `onTravelModeChange` 回调
   - 支持四种交通方式：驾车、步行、骑行、地铁
3. **AmapMap 简化**：
   - 移除 RoutePanel 组件及相关代码
   - 搜索完成后清除之前的路线
   - 切换交通方式时清除旧路线，规划新路线
4. **样式更新**：
   - 添加交通方式按钮样式（横向排列，图标+文字）
   - 选中状态蓝色高亮

# 20260405 点击地图设置终点功能

1. **新增功能**：点击地图任意位置作为终点的功能
2. **实现细节**：
   - 添加 `handleMapClick` 函数处理地图点击事件
   - 使用 `AMap.Geocoder` 进行逆地理编码，获取点击位置的详细地址信息
   - 点击后自动在搜索框中填充地址名称
   - 在地图上添加标记点，显示点击位置的名称和地址
   - 点击标记可查看详细信息窗口
3. **代码改动**：
   - `AmapMap.jsx`:
     - 添加了地图点击事件监听：`mapRef.current.on('click', handleMapClick)`
     - 使用逆地理编码将坐标转换为地址
     - 添加了 `searchBoxValue` 状态和 `updateSearchBoxValue` 方法
     - 自动清除之前的搜索结果和路线
   - `SearchBox.jsx`:
     - 添加了 `onValueUpdate` 回调属性
     - 添加了 `updateInputValue` 方法更新输入框值
     - 添加了 `useEffect` 监听全局更新事件
4. **用户体验**：
   - 点击地图任意位置，自动填充地址到搜索框
   - 地图自动调整视野到点击位置（缩放到 16 级）
   - 添加带动画的标记点，显示位置名称
   - 点击标记显示详细信息窗口

# 20260405 收藏夹链路修复

1. **修复收藏添加流程**：
   - `App.jsx` 新增 `selectedLocation` 状态，接收地图点击或搜索得到的位置
   - `Favorites.jsx` 接收 `selectedLocation`，在添加表单中直接展示当前选中的经纬度和地址
   - 添加收藏表单增加提示文案，明确“打开表单后可在地图上点击或搜索选择位置”
2. **修复收藏定位流程**：
   - `AmapMap.jsx` 改为通过 `ref` 暴露 `showLocation` 和 `centerOnLocation`
   - 从收藏夹点击“定位”时，直接在地图上展示该收藏点并移动视角，不再依赖未注册的全局方法
3. **顺手清理实现问题**：
   - `Favorites.jsx` 改为使用 `useState` 初始化函数读取 `localStorage`，避免 effect 内同步 `setState`
   - `AmapMap.jsx` 抽出统一的位置展示逻辑，修复未定义 `AMap` 的引用
   - `SearchBox.jsx` 调整回调定义顺序，移除无用变量，使 `npm run lint` 可通过
4. **修复点击后不定位的问题**：
   - 统一地图点击、搜索结果、收藏夹、`localStorage` 中的坐标格式为普通 `{ lng, lat }`
   - 调用高德地图 `setCenter`、`Marker`、`InfoWindow` 时统一转换为 `[lng, lat]`
   - 避免 `AMap.LngLat` 与普通对象混用导致点击收藏后地图不跳转
5. **修复点击后地图重建的问题**：
   - `App.jsx` 中将传给 `AmapMap` 的回调用 `useCallback` 固定引用
   - 避免点击地图后 `selectedLocation` 更新触发 `AmapMap` 初始化 effect 重新执行
   - 防止地图回到 `DEFAULT_CENTER` 后再次自动定位

# 20260407 路线规划 NO_PARAMS 修复

1. **原因**：`searchEndPoint.location` 存的是普通对象 `{ lng, lat }`，`AMap.Driving` / `Walking` / `Riding` / `Transfer` 的 `search` 需要 **`AMap.LngLat`**（或文档认可的格式），直接传普通对象会返回 **`NO_PARAMS`**。
2. **修改**：`AmapMap.jsx` 增加 `toAMapLngLat(AMap, location)`，在 `handleTravelModeChange` 的插件回调里将起点、终点转为 `new AMap.LngLat(lng, lat)` 再调用 `route.search`；公交逆地理 `getAddress` 也改为使用转换后的终点。

# 20260407 删除未使用的 RoutePanel

1. 删除 `my-app/src/components/RoutePanel.jsx`、`RoutePanel.css`（无任何引用，历史版本中已从主流程移除）。

# 20260407 收藏备注与默认展示名

1. **`Favorites.jsx`**：添加收藏时「名称」改为选填「备注」；保存时的列表标题为 `trim(备注) || 地图选中点的 name || 地址`，仅要求已选位置；表单下方显示即将保存的「展示名称」预览。

# 20260409 figma 原型补齐可运行工程

1. **补齐运行入口**：为 `figma/` 新增 `index.html` 和 `src/main.tsx`，挂载 React 应用并引入全局样式。
2. **完善脚本**：在 `figma/package.json` 中补充 `dev`、`build`、`preview`，使其成为标准 Vite 前端项目。
3. **依赖调整**：将 `react`、`react-dom` 改为项目真实依赖，并使用 `npm install --legacy-peer-deps` 完成安装，绕过 Figma 导出依赖集合中的 peer 冲突。
4. **验证结果**：`cd figma && npm run build` 已成功，当前可作为独立前端原型运行和打包。
5. **仓库说明**：新增根目录 `README.md`，补充 `my-app/` 与 `figma/` 的安装、启动和构建方式。

# 20260411 figma 地图切换为高德

1. **地图渲染方式替换**：`figma/src/app/components/MapView.tsx` 从 OpenStreetMap `iframe` 改为高德 JS API 动态地图，支持真实地图交互。
2. **点位与路线展示**：基于活动坐标渲染彩色编号 Marker，并使用 `AMap.Polyline` 连线形成当天/全程路线。
3. **数据格式适配**：将原数据中的 `[lat, lng]` 转换为高德需要的 `[lng, lat]`，保证点位和路径位置正确。
4. **错误兜底提示**：新增地图加载态与失败态，缺少 `VITE_AMAP_KEY` 或加载异常时给出明确提示。
5. **依赖补充**：`figma/package.json` 新增 `@amap/amap-jsapi-loader` 依赖。

# 20260411 figma routes.tsx JSX 作用域

1. **`figma/src/app/routes.tsx`**：在文件顶部增加 `import React from "react"`，消除「JSX 需要 React 在作用域内」的 TypeScript/ESLint 报错（经典 JSX 运行时假定）。

# 20260411 figma React 类型定义

1. **`figma/package.json`**：在 `devDependencies` 中增加 `@types/react`、`@types/react-dom`（与 `react` 19 对齐），解决 `react/jsx-runtime` 无声明文件、隐式 `any` 的 TypeScript 报错。
2. **安装**：使用 `npm install --legacy-peer-deps` 完成安装（与现有 peer 依赖策略一致）。
3. **验证**：`npm run build` 与 `tsc --noEmit`（通过 `npx -p typescript@5.8.3 tsc`）通过。

# 20260412 地图点位聚焦与线路降噪

1. **点位关系高亮**：`my-app/src/components/AmapMap.jsx` 从“单 marker 引用”改为“节点/边集合管理”，支持点击 marker 时聚焦当前点、提亮相连点并淡化其余点位。
2. **路线关系高亮**：驾车/步行/骑行/地铁改为提取路径后用 `AMap.Polyline` 自绘，点击点位时仅凸显关联线路，其他线路降透明度显示。
3. **交互细节**：
   - 点位按状态切换视觉层级（`active / connected / dimmed`），并通过 `zIndex` 保证焦点在最上层。
   - 新增起点节点（当前位置）并与终点节点建立边关系，便于表达“点击点位 -> 高亮关联路径”。
4. **样式补充**：`my-app/src/App.css` 新增 `.map-node` 系列样式，包含缩放、饱和度、阴影与淡化效果，提升地图上的焦点引导。

# 20260412 figma 地图点位聚焦交互优化

1. **`figma/src/app/components/MapView.tsx`**：路线从单条 `Polyline` 改为分段线路（`i -> i+1`），便于按点击点位高亮关联线段。
2. **点位聚焦策略**：新增 `selectedIndex` 状态，点击 marker 后将点位分为 `active / related / dimmed` 三层视觉状态，支持淡化非关联 marker。
3. **线路聚焦策略**：仅提亮与当前点位相连的两段线路（前一段与后一段），其余线路降透明度与权重，突出路径关系。
4. **交互补充**：
   - 点击地图空白可重置为全量展示；
   - 下方活动列表改为可点击并与地图联动，同步高亮当前点位与相邻点位。
5. **视觉细节**：为高亮点位增加放大、光晕与层级（`zIndex`）提升，增强地图上的焦点引导。

# 20260412 figma 线路可点击详情与联动高亮

1. **`figma/src/app/components/MapView.tsx`**：为分段 `Polyline` 增加 `mouseover / mouseout / click` 事件，支持线路悬停预览与点击选中。
2. **线路信息面板**：新增地图右上角“路段详情卡”，展示起终点、推荐交通、时段衔接、安排原因与可替代路线。
3. **视觉层级优化**：
   - 选中线路 `active`（更粗、更亮、方向箭头）；
   - 相邻线路 `related`（次高亮）；
   - 非关联线路 `dimmed`（低透明）；
   - 悬停线路 `hovered`（即时反馈）。
4. **点线联动规则**：
   - 点击线路时，高亮该段两端点位并淡化其余点位；
   - 点击点位时清空线路选中，恢复点位详情模式；
   - 点击地图空白重置所有焦点状态。
5. **可用性增强**：路段详情卡支持“上一段 / 下一段”快速切换，便于连续浏览整条路线的移动信息。

# 20260412 figma 接入 AI 生成计划最小闭环

1. **新增本地 AI 接口服务**：添加 `figma/server/ai-server.mjs`，提供 `POST /api/ai/generate-plan`，按既定 TravelPlan schema 向 Anthropic 请求并返回结构化数组。
2. **前端请求封装**：新增 `figma/src/app/services/aiPlanClient.ts`，统一处理 AI 计划生成接口调用与错误处理。
3. **提示词模板沉淀**：新增 `figma/src/app/data/aiPlanPrompts.ts`，将系统提示词和用户提示词构建逻辑模块化，便于后续扩展参数。
4. **计划持久化与合并读取**：新增 `figma/src/app/data/plansStore.ts`，将 AI 生成计划写入 `localStorage` 并与 `mockPlans` 合并展示。
5. **列表页接入生成入口**：`figma/src/app/pages/PlansListPage.tsx` 新增城市输入与“一键 AI 生成”按钮，生成结果即时插入卡片列表并可搜索。
6. **详情页兼容 AI 计划**：`figma/src/app/pages/PlanDetailPage.tsx` 改为从合并后的计划集合读取，确保点击 AI 新计划可进入详情页。
7. **本地联调支持**：`figma/vite.config.ts` 增加 `/api` 代理到 `http://localhost:8787`，`figma/package.json` 增加 `ai:server` 脚本，新增 `figma/.env.ai.example` 环境变量示例。

# 20260414 figma 首页接入高德搜索定位与20个候选点

1. **新增候选点发现服务**：新增 `figma/src/app/services/amapDiscoveryClient.ts`，封装高德地点检索与周边检索流程：先按关键词定位中心点，再混合拉取附近“美食/景点”候选。
2. **候选点混合策略**：对高德返回数据做去重、距离计算与分类（美食/景点），按混合策略输出最多 20 个候选点，保证首版有稳定的“混合推荐”结果。
3. **新增首页地图组件**：新增 `figma/src/app/components/DiscoveryMapView.tsx`，在首页展示搜索中心点与候选点 Marker，并自动 fit view。
4. **首页交互升级**：`figma/src/app/pages/PlansListPage.tsx` 新增“地点搜索与候选点推荐”模块，支持输入地点、回车/按钮搜索、地图定位、候选点浮现式卡片展示（含类别与距离）。
5. **构建验证**：`cd figma && npm run build` 通过。

# 20260414 figma 首页无搜索自动定位

1. **自动定位入口**：`figma/src/app/pages/PlansListPage.tsx` 新增首屏 `useEffect`，在用户未主动搜索时自动请求浏览器定位并拉取附近候选点。
2. **经纬度发现能力**：`figma/src/app/services/amapDiscoveryClient.ts` 新增 `discoverNearbyCandidatesByLocation`，支持按经纬度逆地理解析后直接混合检索周边美食/景点。
3. **稳定性处理**：自动定位增加单次尝试控制，避免失败后反复触发定位请求；失败时提示用户手动搜索。

# 20260414 figma 候选点 Marker 视觉与交互升级

1. **中心点 Marker 重构**：`figma/src/app/components/DiscoveryMapView.tsx` 将“搜索中心”改为“你在这里”胶囊样式，增加呼吸光晕动画，提升定位识别度。
2. **候选点状态化渲染**：候选 Marker 增加 `normal / hovered / active / dimmed` 四态，支持悬停放大、选中高亮、非焦点点位弱化。
3. **点位信息弹层**：点击候选点后展示 InfoWindow（名称、类别、地址），并在地图空白点击时清空焦点态。

# 20260414 figma 去除候选点并启用高德官方定位按钮

1. **候选点功能下线**：`figma/src/app/pages/PlansListPage.tsx` 移除“20 个候选点推荐”列表与对应状态逻辑，首页改为纯“地点搜索与定位”流程。
2. **定位服务简化**：`figma/src/app/services/amapDiscoveryClient.ts` 重构为仅提供地点定位能力：关键词定位（PlaceSearch）与坐标逆地理定位（Geocoder）。
3. **地图控件升级**：`figma/src/app/components/DiscoveryMapView.tsx` 接入高德官方 `AMap.Geolocation` 控件（右下角定位按钮），支持一键定位并回填到页面中心点信息。
4. **首屏体验保留**：页面首次进入仍会尝试一次自动定位，失败时可手动搜索或点击地图右下角高德定位按钮。

# 20260415 figma DiscoveryMapView 自动定位后 Marker 不显示

1. **原因**：地图初始化 `useEffect` 依赖了 `center` 与父组件每次渲染新建的 `onLocate`/`onLocateError`，`center` 更新或父重渲染会销毁并异步重建地图，与放置 Marker 的 effect 竞态；且自动定位若早于地图 `load` 完成，Marker effect 因 `mapRef` 仍为空提前返回后不会再次执行。
2. **修复**：`DiscoveryMapView` 地图仅挂载时创建一次；定位回调改用 `ref`；增加 `mapReady` 状态，待地图就绪后再根据 `center` 创建/更新中心 Marker 与视野。

# 20260415 figma 首屏自动定位与按钮定位不一致

1. **原因**：浏览器 `navigator.geolocation` 返回 **WGS84（GPS）**，高德底图与 `AMap.Geolocation` 结果为 **GCJ-02**；首屏用浏览器坐标直接画点会偏几百米，右下角按钮走 SDK，故与地图一致。
2. **修复**：`locateCenterByLocation` 增加 `fromBrowserGps`，首屏传入后对坐标做 `AMap.convertFrom(..., 'gps')` 再逆地理与回填 `center`。

# 20260415 figma 地点搜索框默认清空

1. **说明**：原 `searchKeyword` 初始值为「深圳湾公园」。
2. **调整**：`PlansListPage` 改为 `useState('')`，首屏输入框无预填；自动定位或地图定位成功仍会照旧 `setSearchKeyword` 填当前地名。

# 20260415 my-app 搜索联想提示恢复

1. **AutoComplete 输入绑定加固**：`my-app/src/components/SearchBox.jsx` 将 `AMap.AutoComplete` 的 `input` 参数改为稳定的 DOM `id`（`amap-search-input`），避免直接传 DOM 引用在部分环境下不触发联想。
2. **联想结果范围与类型明确**：补充 `citylimit: false` 与 `datatype: 'poi'`，提升跨城关键词的提示命中率与稳定性。
3. **建议面板层级修复**：`my-app/src/App.css` 为 `.amap-sug-result` 增加 `z-index: 2001 !important`，避免建议列表被地图图层遮挡导致“看起来没有提示”。

# 20260415 my-app 搜索框占位文案移除

1. **默认文案调整**：`my-app/src/components/SearchBox.jsx` 将搜索输入框 `placeholder` 改为空字符串，刷新后不再显示“加载中...”或“搜索地点...”占位提示。

# 20260415 my-app 地图点击改为单点模式

1. **点击地图先清理覆盖物**：`my-app/src/components/AmapMap.jsx` 新增 `clearAllMapOverlays`，点击地图选点前会清除已有 marker、路线与地铁 route service，并重置当前焦点与路线选择状态。
2. **地图点击仅保留当前点**：`displayLocation` 新增 `replaceExisting` 参数，`handleMapClick` 传入 `{ replaceExisting: true }`，实现“点击新点 -> 清空旧点 -> 居中并落新 marker”的单点展示行为。

# 20260420 figma 计划坐标顺序统一为经度在前

1. **坐标规范调整**：将计划数据 `coordinates` 语义从 `[纬度, 经度]` 统一为 `[经度, 纬度]`，并同步更新 `figma/src/app/data/aiPlanPrompts.ts`、`figma/server/ai_server.py`、`figma/server/ai-server.mjs` 中的约束文案。
2. **地图渲染逻辑同步**：`figma/src/app/components/MapView.tsx` 改为按 `[经度, 纬度]` 直接生成高德点位，不再做前后反转；列表里的坐标展示改为“经度/纬度”明确标识。
3. **内置示例数据迁移**：`figma/src/app/data/mockPlans.ts` 全量 `coordinates` 数据改为 `[经度, 纬度]`，避免新旧规则混用导致点位偏移。

# 20260420 figma 计划页路线改为高德驾车分段并增加多色渲染

1. **路线来源升级**：`figma/src/app/components/MapView.tsx` 接入 `AMap.Driving`，按相邻活动点逐段请求驾车路线，优先绘制真实道路轨迹。
2. **稳定性兜底**：单段驾车规划失败时回退到起终点直线，确保路线总能展示，不因某段异常导致地图空白。
3. **可读性增强**：新增分段色板，默认不同路段使用不同颜色；选中路段仍保持深蓝高亮，兼顾区分度与交互聚焦。

# 20260420 figma 计划生成补读最近对话并减少机械追问

1. **补读历史对话**：`figma/server/ai_server.py` 在生成计划前会读取最近几轮消息，并将其一并提供给结构化提取，改善“按上面那个来”“从之前那个信息来”这类引用理解。
2. **关键字段回填**：新增基于最近用户消息的兜底回填逻辑，可从前文自动补出城市、天数与路线风格关键词，不再只盯着最后一句话。
3. **生成门槛放宽**：计划生成所需必填项收敛为城市和天数；预算与风格缺失时使用默认值，避免因非关键槽位缺失反复追问。
4. **显式生成直接执行**：当用户已经明确表达“帮我生成”“生成一份吧”且上下文已足够时，系统会直接生成计划，不再额外要求再确认一轮。

# 20260420 figma 新对话生成计划覆盖旧计划修复

1. **根因**：AI 返回的新计划 `id` 重复使用了固定值（如 `sz_001`），前端 `upsertGeneratedPlan` 依据 `id` 去重时会把旧计划当成同一条记录覆盖掉。
2. **修复**：`figma/server/ai_server.py` 在每次“新生成计划”成功后统一重写为唯一 `plan.id`，避免不同会话创建的计划互相覆盖。
3. **影响范围**：仅影响“新建计划”路径；计划详情页内的“修改当前计划”仍保留原 `id`，不会打断已有计划与会话的关联关系。

# 20260420 figma 生成计划新增“复刻当前攻略”模式

1. **新增模式**：当用户表达“生成一样的计划”“按这个攻略来”“复刻当前路线”等意图时，后端会切换到 `replicate_guide` 生成模式，而不是普通的按风格自由发挥。
2. **参考正文入模**：系统会从最近对话里提取最近一段攻略型用户消息，作为 `referenceGuide` 写入生成 prompt，强约束沿用原攻略里的 POI、顺序和片区。
3. **防止擅自换点**：复刻模式下的 prompt 明确要求优先保留参考攻略中的具体地点，例如出现“海上世界文化艺术中心”时，不要自行改写成 OCT/OTC 或其他艺术中心。

# 20260420 figma 计划活动坐标改为高德补全

1. **根因**：AI 生成计划时会直接输出 `activities[].coordinates`，而前端地图会原样使用这些坐标；一旦模型把深圳点位编偏，就会出现落到香港等错误位置。
2. **修复**：`figma/server/ai_server.py` 新增高德地点搜索补点逻辑，在新生成计划和更新计划后，优先根据活动标题/描述用高德 API 获取深圳本地坐标并覆盖原值。
3. **兜底策略**：若高德未返回可用结果，则保留原始坐标，避免因个别活动无法解析导致整条计划生成失败。
4. **调试增强**：新增活动级别补点日志，记录每个活动最终使用的搜索关键词、命中的高德 POI 名称与经纬度，便于定位“为什么补错点”。

# 20260420 figma 预算提取误识别修复

1. **根因**：之前的数字区间提取过宽，类似 `图1.13-18` 的文本也可能被误识别为 `budgetRange=¥13-18`。
2. **修复**：预算提取改为只有在出现 `预算/花费/费用/¥/元` 等明确预算信号时才抽取；会话流里若没有预算上下文，也会主动移除 AI 返回的 `budgetRange`。

# 20260420 figma 计划封面接入轻量选图服务

1. **新增选图服务**：`figma/server/ai_server.py` 增加轻量选图逻辑，不再直接信任模型返回的 `image` 字段，而是基于目的地、计划名、标签与活动地点关键词生成稳定的 Unsplash Source URL。
2. **生成与更新统一**：新建计划（`generate_plan_from_draft`）和编辑计划（`update_plan_from_existing`）都会统一执行选图服务，确保封面图风格与行程更相关且来源一致。
3. **前端兜底增强**：`TravelPlanCard` 与 `PlanDetailPage` 的图片渲染切换为 `ImageWithFallback`，当外链异常时可自动显示占位图，避免页面出现破图。
