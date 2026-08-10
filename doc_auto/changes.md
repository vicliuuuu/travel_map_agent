# map 模块变更记录

## 2026-07-29

- 新增初代旅行规划 Agent 页面：`index.html`、`styles.css`、`app.js`。
- 接入 Google Maps JavaScript API（动态注入脚本），支持城市定位与候选景点拉取。
- 支持地图点击新增自定义景点。
- 新增行程规划核心逻辑：`planner.js`，可按天分配景点并生成时间段。
- 新增测试：`tests/planner.test.js`。
- 新增使用说明：`README.md`。

修改时间：2026-07-29 17:10 (UTC+8)

## 2026-07-30

- 行程输入新增“目标国家”字段，并在结果中展示“城市, 国家”。
- 移除 Google 地图选点流程，改为手动输入景点（每行一个，支持 `景点名 | 地址`）。
- 新增手动景点解析逻辑：`TravelPlanner.parseManualPlaces`。
- 新增解析逻辑测试：`tests/planner.test.js`。
- 更新使用说明：`README.md`（含 Google Maps API Key 获取步骤）。

修改时间：2026-07-30 15:18 (UTC+8)

## 2026-07-30

- 恢复 Google 地图接入，但用途改为“路线展示”而非“地图选点”。
- 新增 API Key 输入与连接地图按钮：`index.html`、`app.js`。
- 规划后基于 Geocoding + Directions 绘制整体路线与编号标记点。
- 新增路线点提取逻辑：`TravelPlanner.buildRouteStops`。
- 新增测试：`tests/planner.test.js`（验证 route stops 顺序与天数信息）。
- 更新文档：`README.md`（地图展示流程与 API 启用清单）。
- 预留地图选点扩展切口：`featureFlags.mapPickEntryEnabled`（默认关闭，不影响当前流程）。

修改时间：2026-07-30 15:23 (UTC+8)

## 2026-07-30

- 新增 LLM 接入模块：`llm.js`，支持 OpenAI 兼容 `chat/completions` 分析。
- 新增 LLM 配置与触发入口：`index.html`、`app.js`（Base URL / API Key / Model）。
- 新增“先分析后规划”流程：LLM 返回景点建议时长、优先级、理由并回灌规划。
- `planner.js` 支持景点级时长：`suggestedDurationMin` / `durationMin`，并写入行程结果。
- 手动景点输入新增可选第三段：`景点名 | 地址 | 建议分钟`。
- 新增测试：`tests/llm.test.js` 与 `tests/planner.test.js` 增强用例。
- 更新文档：`README.md`（LLM 接入说明与安全提示）。

修改时间：2026-07-30 15:29 (UTC+8)

## 2026-07-30

- LLM 配置新增“供应商自动识别 + 模型下拉”：根据 Base URL 自动判断平台。
- 新增识别逻辑：`TravelLlm.detectProviderByBaseUrl` 与 `TravelLlm.getProviderModels`。
- 界面新增字段：`已识别供应商`、`LLM Model（自动识别下拉）`，并支持手动覆盖。
- 增加测试：`tests/llm.test.js`（Qwen/OpenAI 识别与模型列表验证）。
- 更新文档：`README.md`（自动识别模型说明）。

修改时间：2026-07-30 15:36 (UTC+8)

## 2026-07-30

- 新增后端服务：`server.js`，支持静态资源托管与 `POST /api/agent/plan`。
- 新增 Agent 工具调用规划：LLM 可通过 Google Maps 工具查询地理编码与路程时长。
- 新增工具规划融合模块：`agent-planner.js`（合并建议时长、优先级与推荐顺序）。
- 前端新增按钮：`Agent 智能规划（LLM+Google Maps工具）`，并接入后端规划接口。
- `llm.js` 解析增强：支持 `recommendedOrder` 输出。
- 新增测试：`tests/agent-planner.test.js`，并扩展 `tests/llm.test.js`。
- 更新文档：`README.md`（启动方式切换为 `node server.js` 与 Agent 规划说明）。

修改时间：2026-07-30 16:13 (UTC+8)

## 2026-07-30

- 新增版本文档：`doc_auto/v1.0.md`，沉淀当前阶段完整能力与架构说明。
- `README.md` 新增版本标识入口，指向 `v1.0` 文档。
- 新增版本标记文件：`VERSION`（当前值 `v1.0`）。

修改时间：2026-07-30 16:20 (UTC+8)

## 2026-07-31

- 目标国家/城市并排展示，新增本地自动补全下拉（`location-data.js`）。
- 景点输入改为网格形式：默认一行，支持 `+ 添加景点` 与行内删除。
- 移除「自动规划行程」按钮；无 LLM 时仅支持「在地图上标点」（按输入顺序 1、2、3…）。
- 智能规划结果面板仅在 Agent 规划后展示，避免无 LLM 时的误导性行程输出。
- 新增 `TravelPlanner.parsePlaceRows` 与相关测试。

修改时间：2026-07-31 13:51 (UTC+8)

## 2026-07-31

- 修复地图标点 bug：地理编码改为使用「景点名 + 城市 + 国家」，避免所有点挤在同一城市中心。
- 新增 `buildGeocodeQuery`，标点后输出具体地址与经纬度参考信息。
- 国家/城市输入框 placeholder 简化为「例如：China」「例如：Paris」。

修改时间：2026-07-31 14:01 (UTC+8)

## 2026-07-31

- 移除目标国家/城市的下拉自动补全，改为纯文本输入。

修改时间：2026-07-31 14:09 (UTC+8)

## 2026-07-31

- 默认 LLM 配置切换为通义千问（DashScope），并补充 Qwen API Key 获取说明。

修改时间：2026-07-31 15:01 (UTC+8)

## 2026-07-31

- 重构 Agent 提示词：景点速览、不走回头路策略、路书时间段、目的地注意事项。
- 新增路书 JSON 解析与前端「智能路书」展示（概述/策略/景点速览/游览步骤/注意事项）。
- 后端返回 `roadbook`、`placeSpotlights`、`precautions`、`routeStrategy` 等字段。

修改时间：2026-07-31 15:32 (UTC+8)

## 2026-07-31

- **版本锁定为内测 v1.0**：更新 `VERSION`、`README.md`、版本文档 `doc_auto/内测-v1.0.md`。
- 原 `doc_auto/v1.0.md` 归档替换为内测 v1.0 完整说明（反映地图标点、智能路书、Qwen 默认等全部现行能力）。
- 页面标题更新为「旅行规划 Agent · 内测 v1.0」。

修改时间：2026-07-31 16:23 (UTC+8)

## 2026-07-31

- 新增下一版本规划文档：`doc_auto/内测-v1.1-改进规划.md`（幻觉治理、输入甄别、CoT 反思方案；仅文档，未改代码）。

修改时间：2026-07-31 16:41 (UTC+8)

## 2026-07-31

- `内测-v1.1-改进规划.md` 补充 §3：多目的地层级输入（国家/城市可添加、景点归属城市、布局重构）及跨国/跨城场景（北京+天津、哥本哈根+马尔默）。

修改时间：2026-07-31 17:50 (UTC+8)

## 2026-07-31

- `内测-v1.1-改进规划.md` 补充 §4：酒店锚点（单酒店、入住/退房日期、每日起终点回酒店）；§5 Prompt 综合重写草案（含 `dailyPlans`、`lodgingSummary`）；同步更新优先级、风险与差异表。

修改时间：2026-07-31 18:07 (UTC+8)

## 2026-08-02

- 实现内测 v1.1 P0/P1 主路径：左侧输入区升级为「酒店 + 多国家/多城市/城市内景点」层级结构（`index.html`、`styles.css`、`app.js`）。
- 前端新增单酒店入住/退房输入与夜数自动推算，行程天数与住宿区间联动（`app.js`、`planner.js`）。
- 后端 `POST /api/agent/plan` 支持 `destinations + lodging`，并兼容旧版 `country/city/places` 输入（`server.js`、`planner.js`）。
- Agent Prompt 升级到 v1.1 输出结构：`lodgingSummary`、`dailyPlans`、`validation`、`alternativeProposals`（`llm.js`）。
- 新增行程校验能力：景点声明归属与 geocode 结果比对、按日时长可行性评估（含酒店往返启发式）（`server.js`、`agent-planner.js`）。
- 智能路书面板新增住宿摘要、按日闭环路书、校验结果与替代方案展示（`app.js`）。
- 补充并通过测试：`tests/planner.test.js`、`tests/llm.test.js`、`tests/agent-planner.test.js`。

修改时间：2026-08-02 10:50 (UTC+8)

## 2026-08-02

- 调整酒店日期联动：入住/退房仅计算“夜数参考”，不再自动覆盖用户填写的游玩天数（`app.js`、`server.js`、`index.html`）。
- 调整默认输入：目的地初始化不再预填 `China / Beijing`，改为完全空白由用户自行填写（`app.js`）。
- 扩充 Qwen 模型下拉预设，补充 `qwen-plus-latest`、`qwen-max-latest`、`qwen3-plus`、`qwen3-max` 等可选项（`llm.js`）。
- 地图新增酒店独立标记：在标点模式与智能路书地图渲染中均尝试添加 `H` 酒店点（`app.js`）。

修改时间：2026-08-02 11:14 (UTC+8)

## 2026-08-02

- 实现 A+B 方案：新增 `/api/agent/plan/stream` 流式进度接口（NDJSON），前端接入阶段提示与进度条（`server.js`、`app.js`、`index.html`、`styles.css`）。
- 修复跨城误判：城市/国家归属匹配改为去音符归一化比较（如 `Malmo` 与 `Malmö` 不再误判不一致）（`server.js`）。
- 修复“2天3点却判不可行”链路：可行性评估改为基于系统构建的 `planData -> dailyPlans`，不再信任模型随意输出的 `validation.timeFeasibility`（`server.js`、`agent-planner.js`）。
- 修复“按日行程重复/漏点”问题：`dailyPlans` 改为由后端确定性生成，确保与 `recommendedOrder` 一致、每个景点仅出现一次并保持酒店闭环（`agent-planner.js`、`server.js`）。
- 清理不可信待核实报错：`validation.warnings` 仅保留本地可证据化结果，避免模型臆断“地理编码连续失败”等假告警（`server.js`）。
- 新增测试覆盖：`buildDailyPlansFromPlanData` 用例（`tests/agent-planner.test.js`）。

修改时间：2026-08-02 11:22 (UTC+8)

## 2026-08-03

- 优化主界面展示：新增三态布局切换（填写信息居中 / 地图居中 / 智能路书居中），根据输入、标点、规划阶段自动切换（`index.html`、`styles.css`、`app.js`）。
- 新增路书导出能力：在智能路书面板支持导出 `TXT`（包含概述、策略、住宿、按日行程、可行性、注意事项）（`index.html`、`app.js`）。
- 强化“先独立推导可行天数，再对比用户天数”策略：提示词增加两阶段推理要求（先自然规划，再按用户天数对齐）（`llm.js`）。
- 后端新增本地天数决策与景点裁剪：不再盲信用户天数，先估算自然天数；若用户天数不足则自动精简景点并返回替代方案，若用户天数偏多则自动压缩天数（`server.js`）。
- 统一输出一致性：`recommendedOrder`、`placeSpotlights`、`roadbook`、`dailyPlans` 均按最终保留景点同步过滤，避免展示与实际排程不一致（`server.js`）。

修改时间：2026-08-03 10:10 (UTC+8)

## 2026-08-03

- 酒店模块改为“可选项”：仅当填写酒店名称或地址时才进入规划输入，避免被视为必填（`app.js`、`server.js`）。
- 移除酒店入住/退房夜数统计展示，不再在输入区显示“共 N 晚”等自动统计信息（`index.html`、`app.js`）。
- 明确天数依据：行程预估只参考用户填写的 `游玩天数(totalDays)` 与景点路程逻辑，不使用酒店日期作为天数约束（`llm.js`、`server.js`）。

修改时间：2026-08-03 10:11 (UTC+8)

## 2026-08-03

- 输入模型统一：移除独立酒店输入区，改为在每条点位行增加“酒店锚点”勾选，酒店与景点共用同一结构与输入样式（`index.html`、`app.js`、`styles.css`）。
- 酒店字段收敛：酒店只保留位置锚点语义（名称/地址），不再使用入住/离开日期（`app.js`、`server.js`、`llm.js`）。
- 处理链路统一：前端与后端均从点位列表中提取酒店锚点（首个勾选项），并从游览景点集合中剔除，后续流程与既有路书逻辑保持一致（`app.js`、`server.js`、`planner.js`）。
- UI 精简：LLM 配置仅保留模型下拉，不再显示“手动覆盖模型”输入框（`index.html`、`app.js`）。
- 无酒店场景优化：按日路书生成在未设置酒店时不再强行插入“酒店往返”交通段（`agent-planner.js`、`llm.js`）。

修改时间：2026-08-03 10:21 (UTC+8)

## 2026-08-03

- 点位类型交互升级：将“酒店锚点勾选”改为“景点/酒店”下拉选择，且默认值为“景点”（`app.js`、`styles.css`、`index.html`）。
- 前端收集结构同步更新：点位行新增 `type` 字段（`scenic`/`hotel`），并保持 `isHotel` 兼容标记（`app.js`）。

修改时间：2026-08-03 10:28 (UTC+8)

## 2026-08-03

- 新增 `doc_auto/内测-v1.2-改进规划.md`：完成 v1.2 可实现性评估与改进规划草案，覆盖公网可访问、策略升级、跨城交通分段化、酒店闭环稳定性等方向。

修改时间：2026-08-03 11:37 (UTC+8)

## 2026-08-03

- 新增愿景文档 `doc_auto/map-travel-agent-终极构想.md`：沉淀 map travel agent 的终极形态定义，包含八步流程映射、六层架构、三阶段演进路线与终态验收标准。

修改时间：2026-08-03 17:54 (UTC+8)

## 2026-08-04

- 新增学习目录 `agent_study/`，并创建 Day1 学习文档 `agent_study/Day1-Agent架构与项目定位-详细版.md`，覆盖 Agent 核心架构、ReAct/Plan-and-Execute、travel map 项目映射、面试问答模板、实操任务与验收清单。

修改时间：2026-08-04 11:16 (UTC+8)

## 2026-08-06

- 更新 `agent_study/Day1-Agent架构与项目定位-详细版.md`：补充 `Chatbot / RAG / Agent` 区分章节，新增输入-过程-输出对照及 travel map 对照示例，强化 Day1 认知边界内容。

修改时间：2026-08-06 16:08 (UTC+8)

## 2026-08-06

- 新增 Day2 学习文档 `agent_study/Day2-上下文工程与上下文压缩-详细版.md`：系统化覆盖上下文五层模型、装配原则、保真压缩策略、travel map 字段级映射、面试问答模板、实操任务与验收清单。

修改时间：2026-08-06 16:09 (UTC+8)

## 2026-08-06

- 新增 Day3 学习文档 `agent_study/Day3-工具链设计与执行策略-详细版.md`：覆盖工具链定位、schema 设计、调用生命周期、失败恢复、幂等缓存与 travel map 路由策略。
- 新增 Day4 学习文档 `agent_study/Day4-校验与自修复闭环-详细版.md`：覆盖规则化校验器、修复动作库、状态机、防死循环与 fallback 策略。
- 新增 Day5 学习文档 `agent_study/Day5-RAG与Memory系统设计-详细版.md`：覆盖 RAG 检索链路、Memory 设计、写入冲突治理及与工具证据融合。
- 新增 Day6 学习文档 `agent_study/Day6-评测体系与线上治理-详细版.md`：覆盖离线评测、线上监控告警、回放降级与指标体系。
- 新增 Day7 学习文档 `agent_study/Day7-面试整合与项目答辩-详细版.md`：覆盖项目答辩主线、38 题映射策略、案例库与终验标准。

修改时间：2026-08-06 16:14 (UTC+8)

## 2026-08-06

- 新增速查文档 `agent_study/38题索引-速查版.md`：将 38 道面试题按原分组逐题映射到 Day1-Day7 文档章节，附一句话作答方向与 travel map 项目抓手，并给出覆盖度自评与一周目标对照结论。

修改时间：2026-08-06 16:15 (UTC+8)

## 2026-08-05

- 取消论文稿 `C:\Users\EDY\Downloads\name.tex` 的红色修订显示：将 `\rev{}` 宏从 `\textcolor{red}{#1}` 调整为直接输出 `#1`，保留全部文本内容但不再标红。

修改时间：2026-08-05 10:26 (UTC+8)

## 2026-08-06

- 新增 v1.3~v2.0 版本前瞻规划系列文档（每份含前瞻规划 + 提前埋点设计 + 量化评价指标，作为后续版本迭代与验收依据）：
  - `doc_auto/内测-v1.3-前瞻规划.md`：显式状态机 + 自动修复闭环（含全项目 trace 埋点基线）。
  - `doc_auto/内测-v1.4-前瞻规划.md`：策略引擎（多策略模板 + 后端打分器兜底）。
  - `doc_auto/内测-v1.5-前瞻规划.md`：工具层扩展（营业时间/天气/拥堵可插拔）+ 校验层扩展（闭馆/体力/往返成本）。
  - `doc_auto/内测-v1.6-前瞻规划.md`：记忆层（长期偏好）+ 局部重算（增量重规划）+ 多酒店。
  - `doc_auto/内测-v1.7-前瞻规划.md`：可观测与评测体系（trace 查询 + 指标看板 + 评测集门禁 + 回放复盘）。
  - `doc_auto/内测-v2.0-前瞻规划.md`：对话式旅行顾问 + 终态整合验收（Definition of Done）。
- 埋点策略统一：v1.3 建立 trace 事件 schema 基线，v1.4~v1.6 在其上扩展事件字段，v1.7 消费并补全用于计算指标，v2.0 扩展对话维度。

修改时间：2026-08-06 16:31 (UTC+8)

## 2026-08-06

- 为 v1.3~v2.0 六份前瞻规划文档补充「关键任务拆解（难点分解）」与「建议实施顺序」章节：仅拆解有难度、易踩坑的任务，每个难点给出子步骤 + 关键实现点 + 完成判据，作为版本内开发排期依据。
  - v1.3：状态机内核落地、修复动作库（逐动作）、修复决策器与收敛控制、全链路 trace 埋点织入。
  - v1.4：候选生成+剪枝（防组合爆炸）、打分器与权重调参、策略与修复联动。
  - v1.5：可插拔工具接口抽象、闭馆风险时间轴校验、工具降级分级。
  - v1.6：局部重算影响域分析、多酒店按日闭环（含换酒店日）、记忆写入冲突治理。
  - v1.7：trace 存储检索、指标计算口径版本化、回放复盘、评测集与准入门禁。
  - v2.0：约束抽取+主动澄清（含澄清预算）、对话-规划双状态机、结论证据绑定；「全路线收口」顺延为 §10。

修改时间：2026-08-06 16:39 (UTC+8)

## 2026-08-06

- 实现内测 v1.2 核心三块 + 公网部署脚手架（密钥保持 keep 模式，默认策略 `fastest`）：
  - **策略引擎**：`agent-planner.js` 新增策略模板（`fastest`/`least-transfer`/`classic`）、`computeRouteMetrics`/`scoreRoute`/`chooseBestOrder`/`buildGreedyOrder` 打分与择优、`buildStrategyExplanation` 解释；`server.js` 在 LLM 建议顺序与策略候选间择优；前端新增策略下拉与指标展示（`index.html`、`app.js`）。
  - **跨城交通分段**：`server.js` 对跨城相邻段调用 Google Directions `transit`，`agent-planner.parseTransitLegs` 解析步行/轨交/换乘为 `legs`，输出 `transitBreakdown`；按日行程交通段填入可执行分段时长并支持折叠展开（`app.js`、`styles.css`）。
  - **酒店闭环硬约束**：`buildDailyPlansFromPlanData` 结构化强制每日酒店闭环 + `closedLoop` 标记；新增 `verifyHotelClosure`，告警写入 `validation.lodgingWarnings` 与 `validation.hotelClosure`。
  - **公网部署**：新增 `package.json`、`Dockerfile`、`.dockerignore`、`.env.example`、`deploy.md`；`server.js` 增加 CORS 白名单、基础限流、`GET /api/strategies` 与密钥环境变量兜底（`applyEnvKeyFallback`，非破坏性）。
- 测试：`tests/agent-planner.test.js` 新增策略/贪心/transit 解析/酒店闭环等用例，`node --test` 全量通过（31/31）；手工 smoke 验证 `/api/strategies`、限流 429 与静态资源 200。
- 文档与版本：更新 `VERSION`（内测 v1.2.0）、`README.md`、`doc_auto/内测-v1.2-改进规划.md`（补充实现落地记录）。

修改时间：2026-08-06 16:52 (UTC+8)

## 2026-08-06

- 修复 v1.1 遗留的「城市归属校验过严」导致跨城场景景点被全量误排除的 bug（`server.js`）：
  - 现象：填写英文城市名（如 `Copenhagen`/`Malmö`）时，Google 返回本地名（`København`/`Malmö`）导致城市字符串比对失败，四个景点全部进入 `excludedPlaces`，最终行程为空、路线指标显示「总通勤 0 分钟 / 跨城 0 次 / 折返 0 次」。
  - 修复：归属校验改为**仅在国家明确冲突时排除**（且两侧均为可比较的 ASCII 名称时才判定），城市外来名/本地名差异（exonym/endonym）降级为 `validation.warnings` 软提示并保留景点。
  - 新增 `countryConflicts`/`cityNameDiffers`/`isSameLoose`/`looksAsciiComparable`，移除过严的 `matchesDeclaredLocation`；geocode 结果查找兼容 `normalizeText` 与原始小写两种键。
- 回归：`node --test` 全量通过（31/31）。

修改时间：2026-08-06 17:20 (UTC+8)

## 2026-08-06

- 密钥处理落地（keep 模式 + `.env` 嵌入，保留前端可输入接口）：
  - 新增 `.gitignore`（忽略 `.env` 等，防止密钥进 git）。
  - `server.js` 新增 `GET /api/public-config` 与 `EXPOSE_KEYS_TO_FRONTEND` 开关：非敏感默认值（Base URL/Model）始终下发；密钥仅在开关为 `true` 时下发做自测预填。
  - `app.js` 启动时拉取 `/api/public-config`，仅在输入框为空时预填（用户仍可手改）；正式上线设 `EXPOSE_KEYS_TO_FRONTEND=false`，前端不接收密钥。
  - `.env.example` 增加 `EXPOSE_KEYS_TO_FRONTEND` 说明。
- 文档：
  - `deploy.md` 新增「免费平台推荐（2026 现状）」与「用 Render 免费部署」最短路径（Render/Koyeb/Cloud Run/Oracle Always Free 对比 + 国内访问与 Google Maps 限制提示）。
  - `内测-v1.7-前瞻规划.md` §2.2 P1 登记「生产级限流与滥用防护（从 v1.2 顺延）」。
  - `内测-v1.2-改进规划.md` 补充 §8.3 密钥处理、§8.4 差距归属与暂缓（含地图 transit 可视化已确认忽略）。
- 回归：`node --test` 全量通过（31/31）；手工验证 `/api/public-config` 在开关开启时返回预填密钥。

修改时间：2026-08-06 17:40 (UTC+8)

## 2026-08-10

- 实现内测 v1.3「显式状态机 + 自动修复闭环 + 全链路 trace 埋点基线」（P0/P1/P2 全落地，对外接口契约兼容，新增字段均为增量）：
  - **显式状态机**：新增通用引擎 `state-machine.js`（`runStateMachine`，含非法跳转/环路防护/tracer AOP 织入）；`server.js` 的 `buildAgentPlanPayload` 由顺序调用重构为 `build_context → plan_initial → verify → repair → finalize / fallback`，`verify ↔ repair` 为真实收敛环。请求级缺参/空景点仍返回 400（API 契约），规划阶段不可收敛才进 `fallback`。
  - **结构化校验器**：新增 `verifier.js`（`runVerifiers`），输出统一 `{ code, level, message, evidence, pass }` + `score`，覆盖 `TIME_OVERLOAD`/`HOTEL_LOOP_BROKEN`/`CROSS_CITY_CONFLICT`/`TOO_MANY_EMPTY_DAYS`（error 阻断收敛、warn 不阻断）。
  - **修复动作库 + 决策器 + 收敛控制**：新增 `repair.js`，4 类纯函数修复动作 `split_day`/`drop_lowest_priority`/`swap_neighbor`/`merge_day`（各产出 `changeLog`）；决策器 `chooseRepairAction` 按严重度路由、每轮单动作；`shouldStopRepair` 实现 `MAX_REPAIR_ROUNDS`（默认 3）+ `NO_IMPROVE_LIMIT`（默认 2）并保底回退，参数可由环境变量覆盖。
  - **全链路 trace 埋点**：新增 `tracer.js`（schema `1.3.0`），统一 `state_enter/exit`、`tool_call`、`validation`、`repair_action`、`fallback` 事件；payload 摘要化、埋点异常记日志不静默；每请求（含异常）经 `finally` `recordTrace`，内存保留最近 20 条。
  - **调试端点**：`server.js` 新增 `GET /api/debug/last-trace`（`ENABLE_DEBUG_TRACE` 开关，内测默认开），返回最近一次规划完整 trace。
  - **输出增强**：`validation` 新增 `findings`（结构化校验结论）、`repairSummary`（轮次/changeLog/unresolved/reason）、`traceId`；被删景点进 `excludedPlaces` 与「补齐被自动删减的景点」替代方案；顶层新增 `traceId`。
- 测试：新增 `tests/state-machine.test.js`、`tests/repair.test.js`、`tests/verifier.test.js`、`tests/tracer.test.js`，`package.json` test 脚本纳入；全量 `node --test` 通过（60/60）。手工 smoke：`/api/strategies` 200、`/api/debug/last-trace` 空态 404 / 有请求后返回完整 trace、缺参 400、静态资源 200；状态机异常路径 `state_enter/exit(error)` 埋点并经 `finally` 落盘正常。
- 文档与版本：更新 `VERSION`（内测 v1.3.0）、`package.json`（1.3.0）、`README.md`、`.env.example`（新增 `MAX_REPAIR_ROUNDS`/`NO_IMPROVE_LIMIT`/`ENABLE_DEBUG_TRACE`）、`doc_auto/内测-v1.3-前瞻规划.md`（补充 §11 实现落地记录）。

修改时间：2026-08-10 14:52 (UTC+8)

## 2026-08-10

- 智能路书体验重构（v1.3.1）：消除「行程概述 / 路线策略 / 按日行程」相互矛盾，删除噪音「替代方案」，并把天数冲突从「后端替用户拍板」改为「按规则决定或给两套方案」。
  - **天数冲突决策树**（`server.js` 新增可测函数 `decideDayPlan`）：设 `d=系统估算天数`、`r=用户天数`、`gap=|d-r|`。`gap==0` → 单一方案；`gap>1` → 以 LLM 为主的单一方案（**不再静默删点**）；`gap==1` → 给「方案A·你的 r 天」+「方案B·建议 d 天」两套完整方案。`plan_initial` 用其决定主方案（进状态机做校验/修复），`assembleResult` 用 `secondarySpec` 构建结构完整的 `alternativePlan`（含 dailyPlans/metrics/findings）。
  - **单一数据源**：前端 `renderAgentRoadbook` 重构为四段式——①概览头（数据驱动事实条 + 一句受约束点评 + 天数冲突提示，合并原「行程概述/路线策略/住宿摘要」）②景点速览（保留）③按日行程（合并原 LLM `roadbook` 与 `dailyPlans`，只用权威 `dailyPlans` + 车站卡片排版；`gap==1` 时第二方案上下堆叠展示）④校验与提醒（注意事项折叠）。删除 LLM 自由文本 `roadbook` 展示与旧 `alternativeProposals` 噪音区块。
  - **输出 schema（增量）**：新增 `planLabel`、`dayConflict{type,d,r,message}`、`alternativePlan`；`alternativeProposals` 置空（旧自动/幻觉卡片移除）；被删景点在 `excludedPlaces` 标注归属方案。`summary` 前端仅取首句去矛盾。
  - **工程改动**：`server.js` 将 `server.listen` 包进 `require.main === module` 守卫并导出 `decideDayPlan`/`buildAgentPlanPayload`，便于单测；`app.js` 新增 `renderDayCards`/`buildFactLine`/`firstSentence`/`factLineText` 等；`styles.css` 新增概览头/车站卡片/交通连接线/双方案堆叠样式；TXT 导出同步为新结构（含第二方案）。
- 测试：新增 `tests/day-plan.test.js`（覆盖 gap==0 / gap>1 两向 / gap==1 两向共 5 例），`package.json` test 脚本纳入；全量 `node --test` 通过（65/65）。手工 smoke：`require.main` 守卫下服务正常启动，`/api/strategies` 200、静态资源 200、缺参 400 契约不变。

修改时间：2026-08-10 15:40 (UTC+8)

## 2026-08-10

- 登记待解决问题 **OI-1**（内测反馈）：天数冲突场景下「用户天数」方案分天未按城市聚类，导致同城景点被拆到不同天、每日无谓跨城（哥本哈根+马尔默 2 天两天均跨海峡往返）。
  - 根因：① `agent-planner.buildPlanDataFromOrder` 用 `index % days` 轮询分桶，打散聚类顺序；② 打分/校验作用在线性顺序（`computeRouteMetrics`）而非「按日分组」，看不到每日回酒店的天边界；③ `verifier` 的 `CROSS_CITY_CONFLICT` 阈值为单日 ≥2 次，单日 1 次不必要跨城不触发修复。
  - 后续版本核对：v1.4 只在「顺序生成」层做城市聚类、未改分天与打分口径；v1.6 仅跨日边界轻校验；终极构想「全局跨城分天」未落到具体版本 → **无已规划版本明确解决**。
  - 处置：在 `内测-v1.3-前瞻规划.md` 新增 §13「已知待解决问题」记录现象/根因/修复方向（连续分块快修 / cluster-then-assign / 打分校验改按日口径），建议归属 v1.4 或作为 v1.3.2 快修。

修改时间：2026-08-10 16:10 (UTC+8)

## 2026-08-10

- 修复 **OI-1**（v1.3.2 快修，采纳方向 A）：`agent-planner.buildPlanDataFromOrder` 分天算法由 `index % days` 轮询分桶改为**连续分块**（按顺序切 `days` 段、余数前置），使聚类后的同城景点落在同一天，消除「天数冲突方案 A 每天跨海峡往返」的问题（哥本哈根+马尔默 2 天 → Day1 全哥本哈根、Day2 全马尔默，同日跨城降为 0）。
  - 测试：`tests/agent-planner.test.js` 新增 `keeps clustered order contiguous per day (OI-1)` 与 `splits unevenly with remainder front-loaded`；全量 `node --test` 通过（67/67）。
  - 文档：`内测-v1.3-前瞻规划.md` §13 OI-1 追加「修复状态」；方向 B（全局 cluster-then-assign）与方向 C（打分/校验改按日口径）仍留待 v1.4 根治（本次快修依赖传入顺序已按城市聚类）。

修改时间：2026-08-10 16:18 (UTC+8)

## 2026-08-10（内测 v1.4：策略引擎 + 打分兜底 + OI-1 根治）

在 v1.3 状态机/修复闭环基础上落地 v1.4「策略引擎（多策略 + 后端打分器兜底）」P0+P1+P2，并根治 OI-1。对外接口（`POST /api/agent/plan`、`/api/agent/plan/stream`）保持兼容，新增字段均为**增量**；默认策略 + 默认交通偏好（driving）下输出与 v1.3 等价。

- **统一评分器**（新增 `scoring.js`，纯函数无外部依赖）：度量归一化到 `[0,1]`（travel/crossCity/backtrack 越大越差、priority 命中率越大越好），`scoreMetrics` 输出 `{ score, breakdown, normalized }`；`agent-planner.scoreRoute` 重构为委托调用（避免双份评分公式漂移），新增 `scoreRouteDetailed`。
- **候选生成 + 剪枝**（`agent-planner.generateCandidateOrders`）：多路候选（LLM 基准 + 三策略贪心 + 优先级排序 + 调用方注入）→ 去重（顺序等价只留一个）→ 上限 `K`（默认 20，`CANDIDATE_LIMIT` 可覆盖）截断，防组合爆炸；`chooseBestOrder` 输出 `breakdown`/`secondBest`/`candidates` 全排名。
- **OI-1 根治**（方向 B + C）：新增 `clusterOrderByCity`（先按城市稳定聚类，作为唯一顺序源在 `plan_initial` 一次性传导到 enrichedPlaces/分天/planData/roadbook），使**任意策略**（含 fastest）下同城景点同日、消除无谓跨城；新增 `computeDailyMetrics`（按日分组口径的跨城统计，输出到 `routeMetrics.crossCityByDay`/`crossCityWithinDay`，仅上报不改 verifier 阈值——按用户决定 `CROSS_CITY_CONFLICT_THRESHOLD` 维持为 2）。
- **策略解释增强**（`buildStrategyExplanationDetail`）：输出结构化 `strategyExplanation{ strategy, chosenBreakdown, secondBest, scoreGap, reason }`，含「为什么优于次优方案」。
- **策略×修复联动**（`repair.rescorePlanWithStrategy` + 修复上下文 `scoreOrder`）：修复后用当前策略权重重打分，写入 `repair_action` trace 的 `afterScore`，保证修复不破坏策略取向。
- **A/B 多方案对比**（`compareStrategies`）：主方案=用户所选策略，对比方案=同候选集上「与主方案差异最大」的其他策略，输出增量字段 `strategyComparison{ primary, runnerUp{ tradeoff } }`（独立于 v1.3.1 天数 `alternativePlan`，不冲突）；前端概览下新增「策略对比」块。
- **P2 交通模式偏好**（`applyTransportPreference`）：请求体新增 `transportPreference: driving|transit|walking`，以权重乘子作用于打分（driving 为默认零改动）；前端新增「出行方式偏好」选择器。
- **埋点扩展**（`tracer.js` schema `1.3.0 → 1.4.0`）：新增 `strategy_select`（策略/是否用户指定/交通偏好）、`scoring`（候选数/最优分/得分构成）、`alternative_compare`（chosen/rejected/scoreGap/tradeoff）三类事件，复用统一 emit 通道。
- 测试：新增 `tests/scoring.test.js`（7 例）；扩展 `tests/agent-planner.test.js`（候选剪枝/聚类分天/按日口径/解释/对比）与 `tests/repair.test.js`（策略联动）；`package.json` test 脚本纳入 `scoring.test.js`；全量 `node --test` 通过（**87/87**）。手工 smoke：服务正常启动、`/api/strategies` 200。

修改时间：2026-08-10 17:20 (UTC+8)
