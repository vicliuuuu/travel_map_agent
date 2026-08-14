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

## 2026-08-11（内测 v1.5：工具层扩展 + 校验层扩展）

在 v1.4 策略引擎/状态机基础上落地 v1.5「可插拔多事实源 + 校验层扩展」P0+P1+P2。对外接口（`POST /api/agent/plan`、`/api/agent/plan/stream`）保持兼容，新增字段均为**增量**；新工具默认关闭，未启用时输出与 v1.4 等价（doc §1「默认下等价」）。

- **可插拔工具层**（新增 `tools.js`，doc §3.1/§8.1/§8.3）：统一 `Tool` 抽象 `{ name, schema, invoke, cacheKey, normalizeError, timeoutMs, retries, enabled, degradeMode }` + `createToolRegistry`（`register/get/isEnabled/listEnabled/invoke/getStats`）。`invoke` 统一做**幂等缓存**（`cacheKey` 对 args 归一化：trim/小写/去音符/键名排序）、**超时/重试**、**错误码标准化**（`RATE_LIMIT/NOT_FOUND/TIMEOUT/PROVIDER_ERROR/DISABLED/INVALID_ARGS`）、**降级**与**来源标注**，返回结构化结果（不抛出，除 fatal 降级）。
- **降级分级**（doc §8.3）：`skip`（跳过并标注 `unverified`，如天气）/ `conservative`（保守估计，如拥堵系数 1.0）/ `fatal`（致命失败向上抛出，如 geocode 全失败）。降级不静默：`emit tool_degrade` + `logger.warn`（遵循「无静默失败」）。
- **外部事实来源标注**（doc §2.2.3/§4）：`stampFactSource` 为每条外部事实盖上 `source/fetchedAt/verifyState`；注册表命中即 `emit fact_source`，未核实项在前端「风险校验」区块显式标注「（未核实）」。
- **新增外部事实工具**（doc §2.1.2/§2.2）：`opening_hours`（营业时间，P0，附 `google_places` provider：Find Place → Place Details 解析当日 `[open,close]`）、`weather`（P1，provider 待接入）、`congestion`（P1，`conservative` 降级取 factor=1.0）。三者默认关闭，开关 `OPENING_HOURS_ENABLED/WEATHER_ENABLED/CONGESTION_ENABLED`；开启但无 provider 时降级标注 unverified，主流程不中断。
- **校验层扩展**（`verifier.js`，doc §2.1.3/§3.2）：新增 `OPENING_RISK`（时间轴推算 `computeArrivalTimeline`：由当日 09:00 基准起累加游览+通勤得预计到达，晚于闭馆判 error / 数据未核实降级 warn / 剩余不足游览判 warn）、`PHYSICAL_OVERLOAD`（单日游览时长或景点数超阈值 → warn）、`HOTEL_RETURN_COST`（单日回酒店往返占比 > 阈值 → warn）。三者均**按需激活**（未传 `checks` 时不产生任何 finding，保证向后兼容）。
- **修复联动**（`repair.js`）：新增 `advance_place`（把闭馆风险景点在其所在日内前移到首位）；`ROUTER_PRIORITY` 将 `OPENING_RISK` 置于超载之后，`routeCodeToAction` 映射到 `advance_place`。体力/往返为 warn 级不触发修复（不阻断收敛）。
- **埋点扩展**（`tracer.js` schema `1.4.0 → 1.5.0`）：新增 `fact_source`（source/fetchedAt/verifyState）与 `tool_degrade`（tool/reason/fallbackUsed）；`tool_call` 复用统一通道承载新工具 provider/cacheHit/degraded；`validation` 承载新增三类 code。
- **状态机接线**（`server.js`）：`plan_initial` 末尾构建工具注册表并按当前顺序拉取营业时间 → `context.openingHoursByPlace` + `context.v15Checks`（含体力/往返开关）；`verify` 将 `checks` 透传 `runVerifiers`。默认三工具关闭 → openingHoursByPlace 为空 → `OPENING_RISK` 不激活 → 与 v1.4 等价。
- **前端**（`app.js`）：「行程校验」区块新增「风险校验（v1.5）」列表，从 `validation.findings` 过滤展示闭馆/体力/往返，标注 `·必看/·提醒` 与「（未核实）」。
- **工程决策**：存量 `geocode_place`/`get_travel_time` 自带 `toolContext` 缓存且为核心 LLM 工具环，本版本保持原生实现不改路（`native`，避免改动无 CI 覆盖的实时环路），统一抽象先落地到新增外部事实工具；后续版本可平滑迁移。
- 测试：新增 `tests/tools.test.js`（缓存/错误码/三级降级/超时/埋点/内置工具启用共 13 例）；扩展 `tests/verifier.test.js`（时间轴/闭馆 error+unverified warn/体力/往返 + 向后兼容 8 例）与 `tests/repair.test.js`（advance_place + 路由 3 例）；`package.json` test 脚本纳入 `tools.test.js`、版本升至 `1.5.0`；全量 `node --test` 通过（**109/109**）。手工 smoke：服务正常启动、`/api/strategies` 200。

修改时间：2026-08-11 10:50 (UTC+8)

## 2026-08-11（内测 v1.5.1：工具真接入 + 高危 bug 修复 + 体力偏好可选）

在 v1.5.0（骨架 + 校验层）基础上，把工具从"默认关闭/空壳"改为"默认开启/真接入"，并修复了 3 个开启后会导致结论错误的高危 bug。对外接口保持兼容，请求体新增可选字段 `physicalPreference`。

- **工具默认开启 + 去除"假开关"**：`OPENING_HOURS_ENABLED/WEATHER_ENABLED/CONGESTION_ENABLED` 默认改为 `true`。原 `weather/congestion` 传 `fetch:null` 导致"开关设 true 也永远启用不了"的问题已修复——三工具均接入真 provider。
- **接入 Google Weather API**（`buildGoogleWeatherProvider`）：按经纬度取每日预报，抽取降水概率/高低温风险，产出可读提示并**并入 `precautions`**（注意事项）；地区不覆盖/无权限/解析失败时经注册表降级标注 unverified、不进注意事项。`fetchWeatherNotes` 按天（每天首景点坐标 + 实际日期）查询、命中缓存。
- **接入拥堵（内置高峰启发式）**（`tools.peakHourCongestionFactor`）：早高峰 07:00-09:30 / 晚高峰 17:00-19:30 → ×1.4，肩部时段 → ×1.15，其余 ×1.0；无需额外 API，`congestion` 工具默认启用（也支持后续注入 Directions 实时路况 provider）。拥堵修正在 `computeArrivalTimeline` 按出发时刻放大通勤时长，直接作用于闭馆风险判定。
- **高危 bug 修复**：
  1. **通勤缺失按 0 算 → 到达时刻低估、闭馆漏报**：`computeArrivalTimeline` 对缺失/为 0 的 transit 段改用保守兜底 `DEFAULT_TRANSIT_FALLBACK_MIN=30`（与 `evaluateTimeFeasibility` 口径一致）。
  2. **营业时间/天气按"今天"查而非实际游玩日期**：新增 `buildPlaceDateMap`（景点→实际日期，来自 `checkInDate`+天序），`fetchOpeningHoursForOrder`/`fetchWeatherNotes` 均按当天日期查询。
  3. **假开关**：见上，三工具真接入。
- **体力强度做成用户可选**（`verifier.PHYSICAL_PRESETS` + `getPhysicalPreset`）：请求体新增 `physicalPreference: easy|standard|hardcore`（默认 standard），映射到单日游览时长/景点数阈值（5h/4、7h/6、9h/8）；前端新增「体力强度偏好」下拉（`index.html`/`app.js`）。回酒店往返维持标准档（35%，`HOTEL_RETURN_MAX_RATIO` 可配）。
- 测试：`tests/tools.test.js` 增高峰启发式 + 拥堵工具默认启用（+3）；`tests/verifier.test.js` 增通勤兜底 + 拥堵修正 + 体力档位映射（+3，共 +5）；全量 `node --test` 通过（**114/114**）。手工 smoke：默认开启工具下服务正常启动、`/api/strategies` 200。
- **待用户实测**：`opening_hours`/`weather` 依赖真实 Google API 响应，其解析（跨天/24h/午休营业、Weather 覆盖区域）需用户开通 Places API + Weather API 后跑真实行程验证。

修改时间：2026-08-11 11:45 (UTC+8)

## 2026-08-11（内测 v1.5.2：全链路审计与修复 —— 性能 + 正确性 + 一致性）

对 v1.3/v1.4 迭代与整条 pipeline（输入 → LLM 工具环 → 打分/聚类 → 分天 → 校验 → 修复 → 组装）做了一轮系统审计。未发现会崩溃的致命 bug，修复了以下 5 项真问题（含 2 项对用户可感知的功能缺陷）：

- **#1 外部工具串行 → 并发化 + 超时放宽 + 可选收窄范围（性能/成本）**：工具默认开启后，`opening_hours`（每景点 findplace+details 两跳）与 `weather`（每天一次）此前**串行 `await`**，N 景点/M 天 ≈ 2N+M 次串行外部调用，延迟/费用/限流风险大。
  - 新增有界并发映射 `mapWithConcurrency`（保序、不吞异常），`fetchOpeningHoursForOrder`/`fetchWeatherNotes` 改并发，`TOOL_FETCH_CONCURRENCY`（默认 5）可调。
  - `opening_hours` 单次 invoke 含两跳，原 4s 超时偏紧易误判降级，放宽至 9s（`OPENING_HOURS_TIMEOUT_MS`）；`weather` 6s（`WEATHER_TIMEOUT_MS`）。
  - 新增 `OPENING_HOURS_SCOPE=all|high`（默认 all）：设 `high` 仅查高优先级景点，省调用/省钱（全非高优时回退全量，避免闭馆校验完全失明）。
- **#2 用户「每个景点游玩时长」被忽略 → 兜底生效（功能缺陷）**：前端 `visitMinutes` 一直发送但后端从不消费，时长只来自 LLM 建议或硬编码 90，导致该控件"看似可调、实则无效"。
  - `normalizeTripInput` 解析 `visitMinutes`（clamp 30~480）；新增 `applyDefaultVisitDuration` 仅对**无显式时长**的景点回填（不覆盖 LLM 更精确建议），向下游 planData/分天/体力校验一致传导。
- **#3/#4 策略解释与展示指标不同源 → 交付前重打分（一致性）**：`clusterOrderByCity`（OI-1）与修复阶段会改变最终顺序，而结构化解释仍用"选择时"的 `chosenRoute`，多城市/发生修复时"解释的得分构成 ≠ 页面 routeMetrics"。
  - 新增 `agentPlanner.rescoreChosenForDelivery`：以最终交付顺序重算得分构成，并用同一 lookup 对次优候选重打分，使 `strategyExplanation.chosenScore/scoreGap` 与展示同源一致。
- **#5 缺城市元数据虚增跨城计数**：`computeRouteMetrics` 原以 `prevCity !== city` 判跨城，某点无城市元数据（geocode 失败且无 declaredCity）时会被误判为跨城。改为"仅当相邻两点城市均已知且不同"才计跨城，`legs[].crossCity` 同口径。
- 测试：`tests/agent-planner.test.js` 增 `rescoreChosenForDelivery` 与缺城市跨城口径（+3）；`tests/day-plan.test.js` 增 `applyDefaultVisitDuration` 与 `mapWithConcurrency`（保序/限流/不吞异常，+4）；全量 `node --test` 通过（**121/121**）。
- 已知遗留（未在本版处理，风险低）：LLM 工具环超轮次直接 500（缺保底）、`buildDailyPlansFromRoadbook` 为死代码（仍用 `index % dayCount` 老轮询，主流程已不用）、第二方案不做 v1.5 校验。

修改时间：2026-08-11 12:10 (UTC+8)

## 2026-08-11（内测 v1.5.3：外部事实"可见化"+ opening_hours 命中率修复）

针对"结果里看不出用了 Places/Weather API"的反馈，修复了 opening_hours 全 NOT_FOUND 的根因，并把两类外部事实显式透出到结果页。

- **修复 opening_hours 全 NOT_FOUND（根因）**：原 `findplacefromtext` 仅用原始名查询（如"市政厅""利姆港"等中文泛称、无上下文）→ Google 返回 `ZERO_RESULTS`。改为：① 查询词 = `景点名 + 已解析城市 + 国家` 消歧，`locationbias` 由 `point` 改 `circle:5000m`；② 首次未命中时用地理编码规范地址（`formattedAddress`）二次兜底；③ 非 `ZERO_RESULTS` 的真错误（REQUEST_DENIED/OVER_QUERY_LIMIT）按 `PROVIDER_ERROR` 上抛降级，不吞。
- **营业时间透出到每个景点（#1，自证 Places API）**：`buildDailyPlansFromPlanData` 新增 `options.openingHoursByPlace`，把 `{open, close, verifyState, source}` 挂到每个 visit 段；三处调用（verify / assembleResult 兜底 / 第二方案）均透传。前端 `renderOpeningHours` 在每个"站"下展示「营业：HH:MM–HH:MM · 来源 Google Places」（已核实，青色加粗）或「营业时间：未获取（未核实）」（灰字）；纯文本导出同步。新增 `styles.css` 的 `.station-hours/.station-hours-missing`。
- **天气无风险也显示（#2）**：`fetchWeatherNotes` 原仅在有风险时进注意事项，好天气什么都不显示。改为只要有 `summary` 就展示当天天气（"第X天（日期）·城市：多云，最高28℃，降水10%。"），有风险追加"，注意X"。
- 测试：`tests/agent-planner.test.js` 增营业时间透出 + 无 map 向后兼容（+2）；全量 `node --test` 通过（**123/123**）。
- **注意**：需重启 `node server.js` 使 provider 改动生效；opening_hours 命中仍依赖 Places API 权限与该景点在 Google 有 POI 记录（纯地名/行政区无营业时间属正常 NOT_FOUND）。

修改时间：2026-08-11 13:15 (UTC+8)

## 2026-08-11（内测 v1.5.4：天气默认关闭 + 日期门控）

反馈：当前流程未采集"实际出行日期"，Weather API 只能取"最近一天"的预报，对几个月后的行程无意义（鸡肋）。

- **天气默认关闭**：`WEATHER_ENABLED` 默认由 `true` 改为 `false`（需显式设 `true` 才启用）。
- **日期门控（即使启用也更扎实）**：`fetchWeatherNotes` 仅对"有实际日期（由入住日期推导）"的天查询；未填入住日期时整体跳过，不再查无意义的"今天天气"。
- 文档：README 环境变量表更新 `WEATHER_ENABLED` 默认值与说明。
- 全量 `node --test` 通过（**123/123**，无用例依赖天气默认值）。

> 后续若增加"出行日期/日期区间"输入，可将默认改回开启，届时日期门控天然生效。

修改时间：2026-08-11 13:20 (UTC+8)

## 2026-08-11（内测 v1.6 首个特性：多酒店 / 换酒店按日闭环）

范围调整：v1.6「长期记忆」因 Render 文件系统临时性 **PENDING**（详见 `内测-v1.6-前瞻规划.md` §0），本版本先实现不依赖记忆的「多酒店 / 换酒店」输入模型重构（§11）。

- **输入模型重构**：景点与酒店拆分为两个独立区块；删除景点行的「景点/酒店」类型下拉；新增独立「住宿（酒店）」区块（可选、可多家，每家含名称/地址/入住/离店日期）。
- **后端多酒店模型**（`agent-planner.js`）：新增 `extractHotels`、`buildDayHotelMap`（第 N 天→当天酒店映射，换酒店 `changeFrom`、空档 `gapDays`）、`validateLodging`（离店≤入住/区间重叠/空档校验）；`buildDailyPlansFromPlanData` 按当日酒店闭环 + **换酒店日行李转移腿**（`luggageTransfer`）+ 空档退化；`verifyHotelClosure` 按当日酒店判定（未标注 hotelName 回退主酒店，兼容单酒店）。
- **server 接线**：`buildDefaultLodging` 支持 `hotels` 数组（`mode:multi`，保留 `hotel` 主指针）；酒店预解析多家循环 geocode；`buildPlaceDateMap` 改用 `buildDayHotelMap` 统一推日期；`lodgingSummary` 输出全部酒店；`lodgingWarnings` 并入日期校验结论。
- **决策对照**（v1.6 §11.3）：日期粒度=仅日期；换酒店日=算新酒店 + 行李转移；空档日=退化无酒店闭环 + 提醒（两者都做）。
- **测试**：新增 `tests/multi-hotel.test.js`（16 例）；全量 `node --test` 通过 **137/137**；修复闭环契约变更引发的 2 个存量回归（`agent-planner`/`verifier` 用例）。
- 涉及文件：`agent-planner.js`、`server.js`、`app.js`、`index.html`、`styles.css`、`tests/multi-hotel.test.js`、`package.json`（test 脚本纳入新用例）。

> 局部重算（v1.6 §8.1）仍待实现；长期记忆 PENDING 待持久化存储方案确定。

修改时间：2026-08-11 16:25 (UTC+8)

## 2026-08-11（内测 v1.6 第二个特性：局部重算 Incremental Replan）

实现 v1.6 §8.1「局部重算」。已定范围：支持 **删除（`remove_place`）+ 移到另一天（`move_place`）** 两类改点；受影响天做「重排序（打分）+ 重算闭环 + 校验」，其余天原样冻结复用；**纯本地计算，不重新调用地图/LLM**（后端无状态，拿不到上次坐标缓存，同时这也是"省调用、耗时下降"的关键）。

- **新增 `replan.js`**：`analyzeImpact`（影响域，删=所在天/移=源天+目标天，"宁可多算一日也不能漏"）、`applyChange`（不改入参应用改点）、`buildTravelLookupFromDailyPlans`（从既有分段建通勤查表，双向命中）、`reoptimizeAffectedDays`（仅受影响天用 `generateCandidateOrders`+`chooseBestOrder` 重排序）、`incrementalReplan`（编排 + `reusedRatio`）。
- **server 接线**：新增 `POST /api/agent/replan`（走限流）；重建 `placeMetaMap`/`travelLookup` → `incrementalReplan` → `buildDailyPlansFromPlanData` 重组 → `verifyHotelClosure`+`runVerifiers`；缺失/非法 `changeEvent`、空 `planData` 返回 400（不静默失败）。
- **埋点**：`tracer.js` 新增 `incremental_replan` 事件（`changeType/affectedScope/reusedRatio/dayCount`），schema 升至 **1.6.0**。
- **前端**（`app.js`/`styles.css`）：「按日行程」主方案每景点加「删除此点 / 移到第 N 天」控件（备选方案只读，事件委托到 `#itineraryResult`）；`performReplan` 调接口并把结果并回后重渲染路书 + 重绘地图，状态栏与概览区显示「仅重算第 X 天、复用 Y%」。
- **测试**：新增 `tests/replan.test.js`（9 例）+ 端到端冒烟（移景点 `affectedDays=[2,3]`、`reusedRatio≈0.33`、目标天获点、`validation.pass`）；全量 `node --test` 通过 **146/146**。
- 涉及文件：`replan.js`（新增）、`server.js`、`tracer.js`、`app.js`、`styles.css`、`tests/replan.test.js`、`package.json`。

> 本版本 v1.6 两个 ACTIVE 特性（多酒店、局部重算）均已落地；长期记忆仍 PENDING 待持久化方案。当前范围内暂未做 `add_place`（新增点需 geocode，会打破"纯本地"，留待后续）。

修改时间：2026-08-11 16:05 (UTC+8)

## 2026-08-11（bug 修复：多酒店地图只标第一家）

- **现象**：多酒店行程在地图上只标出第一家/主酒店。
- **根因**：`app.js` 的 `renderRouteOnMap` 只读取 `lodgingSummary.formattedAddress/hotelName`（单家），未遍历 `lodgingSummary.hotels` 数组。
- **修复**（`app.js`）：改为遍历 `hotels` 逐家标点（兼容旧单酒店结构），多酒店用 `H1/H2/…` 标签区分（单酒店仍为 `H`）；酒店坐标纳入 `fitBounds` 视野；`placeHotelMarker` 支持自定义 `label`；单家标点失败改为 `console.warn` 记录（不静默、不中断整体渲染）。
- 后端无需改动：主规划与局部重算返回的 `lodgingSummary.hotels` 均为 `[{name, formattedAddress, checkInDate, checkOutDate}]`。

修改时间：2026-08-11 16:18 (UTC+8)

## 2026-08-11（bug 修复：多酒店地图只标第一家 · 补「在地图上标点」路径）

- **背景**：上一条修复只覆盖了「Agent 智能规划」后的路线渲染（`renderRouteOnMap`）；「在地图上标点」按钮走的是 `markOrderedPlacesOnMap → resolveHotelForMap`，仍只取 `lodging.hotel` 一家。
- **修复**（`app.js`）：新增 `resolveHotelsForMap`（复数），遍历 `lodging.hotels` 解析全部酒店坐标（兼容旧单 `lodging.hotel`），多酒店标签 `H1/H2/…`、单家仍 `H`，单家解析失败 `console.warn` 记录且不中断其余；`markOrderedPlacesOnMap` 改为逐家标点并把酒店纳入 `fitBounds`，状态栏显示「标记 N 家酒店」。
- 至此地图两条标点路径（智能规划路线、手动在地图上标点）均支持多酒店。

修改时间：2026-08-11 16:40 (UTC+8)

## 2026-08-11（版本号）

- `index.html` 页面标题与页头 `内测 v1.5` → `内测 v1.6`；`package.json` `version` `1.5.4` → `1.6.0`（tracer schema 已同步 `1.6.0`）。

修改时间：2026-08-11 16:40 (UTC+8)

## 2026-08-11（规划优化：真实通勤估天数 + 按城市软对齐分天 + 体力衰减）

针对双城（哥本哈根+马尔默）用例反馈的两个问题：①系统误估 1 天；②同一天内跨城（用户预期一天一城/综合往返最省）。根因与修复：

- **问题①根因**：天数估算里的平均通勤取自 **LLM 乐观路书**（把跨海段严重低估）→ `450+6×16+50≈600` 卡成 1 天；真实通勤 302 分钟本应估 2 天，但真实值是定完天数后才算的。
  - **修复（混合口径，`server.js`）**：新增 `buildCoordLookup` / `haversineKm` / `haversineTravelMin` / `estimateAverageTravelMinHybrid`——天数估算改为**优先用 `travelCache` 真实通勤，缺失相邻段用坐标 haversine（分段速度：<5km 18km/h、<30km 35km/h、≥30km 60km/h）兜底**。零额外 Google API 调用（Directions 仍只在第 4 步对最终跨城段调用），由真实地理距离驱动，跨城/跨海自然变长，**不引入人为「跨城惩罚」**。新增 `day_estimate` 埋点。
- **问题②根因**：`buildPlanDataFromOrder` 按**点数均分**切天，7 点/2 天 → 4+3，把 1 个马尔默点并进了哥本哈根那天。
  - **修复（按城市软对齐，`agent-planner.js`）**：新增 `splitPlacesIntoCityAlignedDays`（+ `chunkContiguousPlaces` / `mergeCityRunsIntoGroups`）——先按城市切「连续同城段」，天数≥城市数时每段至少 1 天、多余天分给最拥挤城市并段内连续均分；天数<城市数时合并相邻「点数之和最小」的城市段（软对齐、不强制一天一城、跨城不可避免时最少化）。`buildPlanDataFromOrder` 新增 `options.cityOf`（缺省退化为旧的连续均分，向后兼容）；server 主/次方案均注入 `placeMetaMap` 的城市。本例即得 Day1=哥本哈根(3)、Day2=马尔默(4)。
- **体力衰减（新增，rate=0.1，用户确认）**：`agent-planner.js` 新增 `fatigueAdjustedVisitMin`——同一天第 k 个景点（0 基）有效游玩耗时 ×(1+0.1k)；并入 `evaluateTimeFeasibility` 的单日耗时（进而作用于 verifier 的 `TIME_OVERLOAD` 与 `suggestedDays`），单日堆点会被放大、自然倾向分到更多天。
- **测试**：`tests/agent-planner.test.js` 新增 6 例（城市对齐分天:等于/多于/少于城市数、无城市退化、疲劳工具、疲劳并入单日耗时）；调整 `tests/verifier.test.js` 的 PHYSICAL_OVERLOAD 边界数据（原 3×200 恰好触发含疲劳后的 TIME_OVERLOAD，改为 3×160 以聚焦「体力=warn、计划仍 pass」）。全量 `node --test` **152/152** 通过。
- 涉及文件：`agent-planner.js`、`server.js`、`tests/agent-planner.test.js`、`tests/verifier.test.js`。

修改时间：2026-08-11 17:35 (UTC+8)

## 2026-08-11（天数估算重做：逐日装箱 + 单日预算随体力强度联动）

承接上一条。用户再次反馈仍估 1 天，并指出**「单链上限 10h」与「体力强度设置」脱钩**（选 7h 档位，天数估算仍按 10h）。核查确认后重做：

- **核查结论（两套数从没打通）**：
  - 单日 **10h(600 分钟)** 是硬编码常量，出现在三处（`server.js` 估算、`agent-planner.js` `evaluateTimeFeasibility`、`verifier.js` `DAY_BUDGET_MIN`），管「游玩+通勤」总量；
  - 体力档位只产出 `maxVisitMinutes`(5/7/9h)+`maxVisits`(4/6/8)，是**纯游玩**上限（不含通勤），且**只**喂给独立的 `PHYSICAL_OVERLOAD` 提醒，**完全不参与天数估算/超载预算**。二者量纲不同、从无关联。
- **修复①天数估算改为「逐日装箱」（`server.js` 重写 `estimateNaturalDaysAndSubset`）**：从 1 天起按城市软对齐切分，取「每天都可行」的最小天数。每天须**同时**满足体力档位三条约束：①纯游玩（含 0.1 疲劳、每天重置）≤ `maxVisitMinutes`；②景点数 ≤ `maxVisits`；③**游玩+段间通勤+当天各自的酒店往返** ≤ 单日总预算×slack。通勤走**混合口径**（新增 `makeHybridLegMin`：真实 `travelCache` 优先→坐标 haversine 兜底），酒店往返每天各算一次（主酒店坐标近似，跨城日自然更贵）。`compactPlaces` 亦按同一约束在 `reqDays` 内按城市软对齐装箱、溢出计入 `droppedPlaces`。
- **修复②单日预算随体力强度缩放（用户确认 8/10/12h）**：`verifier.js` 的体力档位新增 `dayBudgetMin`（轻松 480 / 标准 600 / 硬核 720），并新增 `DAY_BUDGET_SLACK=0.85`（单日只填到预算的 85%，留 15% 时间冗余，用户确认）。`evaluateTimeFeasibility` 新增 `options.dayBudgetMin/slack`（缺省 600、无 buffer，向后兼容）；`runVerifiers` 的 `TIME_OVERLOAD` 改用 `checks.dayBudgetMin/dayBudgetSlack`；`server.js` 的 `v15Checks` 与估算调用点都从体力档位透传，三处口径彻底统一。体力强度自此真正影响「该排几天」。
- **效果（双城 7 点用例）**：7 点堆一天，疲劳后纯游玩 819 分钟 > 420(标准)且 7 > 6 → 1 天不可行 → **估 2 天**；同一 4 点单城行程，标准档=1 天、轻松档=2 天，验证强度联动。
- **测试**：新增 `tests/day-estimate.test.js`（8 例：小负载 1 天 / 跨城 7 点估 2 天 / 强度联动 4 点 / compact 溢出丢点 / `makeHybridLegMin` 三级回退 / `evaluateTimeFeasibility` 预算注入 / `TIME_OVERLOAD` 预算生效）；更新 `tests/verifier.test.js` 的 `getPhysicalPreset` 断言（含 `dayBudgetMin`）。全量 `node --test` **159/159** 通过。
- 涉及文件：`server.js`、`verifier.js`、`agent-planner.js`、`package.json`、`tests/day-estimate.test.js`、`tests/verifier.test.js`。

修改时间：2026-08-11 18:20 (UTC+8)

## 2026-08-14（v1.7 规划范围收敛：依赖落盘的能力 PENDING）

仅文档调整，未改代码。承接讨论：v1.7「回放/历史 trace 存储」与 v1.6 长期记忆撞同一堵墙——Render 临时文件系统 + 后端不回写 GitHub 仓库，数据无法可靠落盘。用户决策：**凡依赖数据落盘/持久化的能力整体 PENDING**，本期 v1.7 仅保留「纯内存的埋点补全 + 单次指标计算」。

- `doc_auto/内测-v1.7-前瞻规划.md`：
  - 顶部状态行改为「范围已收敛（PENDING 决策）」；新增 **§0 范围调整说明**（背景 / 与记忆的异同 / 决策 / 受影响 PENDING 清单 / 仍推进 ACTIVE 清单）。
  - §1 版本定位表、§2.1 P0（Trace 查询可视化、时序看板、baseline 对比 / 门禁）、§2.2 P1（回放、告警、可持久化限流）、§8.1/§8.3/§8.4 均标注 **PENDING**；§8.2 指标计算、埋点补全（`request_summary`/`tokenCost`）标注 **ACTIVE**。
- **ACTIVE（本期可做）**：`request_summary`/`tokenCost` 内存态埋点补全；对单次 / 内存 trace 计算核心指标（成功率、违例率、修复轮次、延迟、局部重算复用率等）；评测集单次跑通出当次指标。
- **PENDING（待持久化存储）**：trace 落盘与 `GET /api/trace/:requestId`、时序看板、回放复盘、baseline 留存与准入门禁、告警阈值、可持久化/跨实例限流；待存储方案确定后可与长期记忆一并解锁。

修改时间：2026-08-14 13:56 (UTC+8)

## 2026-08-14（内测 v1.7 ACTIVE 子集：可观测埋点补全 + 单次指标计算 + 评测集）

按 v1.7 §0 收敛范围实现**不依赖数据落盘**的 ACTIVE 部分（纯内存），PENDING 部分（trace 落盘/回放/时序看板/baseline 门禁/告警/可持久化限流）不实现。

- **埋点补全（内存态）`tracer.js`**：schema `1.6.0` → `1.7.0`；新增 `tokenUsage`（`token_usage` 事件：model/promptTokens/completionTokens/totalTokens/calls）与 `requestSummary`（`request_summary` 事件：totalDurationMs/finalStatus/repairRounds/token，finalStatus 映射 ok→ok、fallback→warn、error→error）两个方法，均走统一 `emit` 通道、不落盘。
- **token 计量 `server.js`**：`runToolCallingAgent` 累计本次规划全部 LLM 调用的 `usage`（prompt/completion/total），返回 `tokenUsage`；`build_context` 存入 `ctx.tokenUsage` 并 `emit token_usage`。
- **请求级汇总 `server.js`**：`buildAgentPlanPayload` 记录 `startedAt`；`finalize` 置 `ctx.finalStatus='ok'`、`fallback` 置 `'fallback'`、状态机异常置 `'error'`（异常照常上抛，不静默）；在收口 `finally` 中 `emit request_summary`（总耗时/终态/修复轮次/token）后再 `recordTrace`。
- **指标引擎 `metrics.js`（新增，纯内存）**：`computeMetricsFromTrace(trace)` 从单次/内存 trace 计算 finalStatus、totalDurationMs、repairRounds、violationCount、warningCount、toolCallCount/toolErrorCount、cacheHitRate、fallbackTriggered、totalTokens、incrementalReusedRatio、stageDurations（request_summary 优先，缺失按文档口径推断）；`aggregateMetrics(traces|metrics[])` 出 successRate/fallbackRate/errorRate/violationRate/avg* 与加权 cacheHitRate；`METRIC_DEFINITIONS` 固化每个指标口径。非法输入抛错（无静默失败）。
- **评测集 `eval/`（新增，纯内存）**：`eval-set.js` 定义 5 个标准场景（跨国跨城 / 同城高密 / 无酒店 / 超载兜底 / 换酒店，覆盖 v1.3–v1.6）含 `expect`；`eval-runner.js` 的 `runEvalSet({cases, runOne})` 注入式跑通 → 抽指标 → 聚合当次报告，`gating:false`、不留 baseline、不落盘；单 case 失败如实记录且不中断其余（无静默失败）。
- **测试**：新增 `tests/metrics.test.js`（7 例：口径精确计算 / 无 summary 推断 / reusedRatio / 非法输入抛错 / 聚合 / 空批 / 口径表）、`tests/eval-set.test.js`（6 例：场景覆盖 / 全量跑通聚合 / 失败隔离 / 缺 runOne 抛错 / 期望标注）；`tests/tracer.test.js` 增 token_usage / request_summary / schema=1.7.0 三例。`package.json` test 脚本纳入两个新测试文件。全量 `node --test` **174/174** 通过（159 → 174）。
- **版本与文档**：`package.json` `1.6.0`→`1.7.0`（描述标注 ACTIVE 子集）、`index.html` 标题/页头 `内测 v1.6`→`内测 v1.7`、`VERSION`→`内测 v1.7.0`、`README.md` 版本行 + v1.7 能力概览 + PENDING 说明。
- **未做（PENDING，见 §0）**：trace 持久化落盘、`GET /api/trace/:requestId`、时序看板、回放复盘、baseline 对比与准入门禁、告警阈值、可持久化/跨实例限流；未改前端展示（指标目前仅在内存 trace / `/api/debug/last-trace` 可见）。

修改时间：2026-08-14 14:08 (UTC+8)

## 2026-08-14（v2.0 立项：对话式旅行副驾驶 · 变体 A 实施方案）

仅文档，未改代码。评估结论：v2.0「对话体验层」在现有代码基础上全部可实现，仅长期记忆（无持久盘）与跨会话回放/门禁（依赖落盘）按既有 PENDING 边界降级。用户拍板采用**变体 A（内存态 v2.0）**，并先落方案文档再开工。

- 新增 `doc_auto/内测-v2.0-实施方案.md`：把 v2.0 前瞻规划落地为可执行方案。
  - §0 范围与边界：ACTIVE（多轮对话/约束抽取+澄清/对话内改行程接 v1.6 replan/证据绑定/解释性对话/多方案推荐/对话埋点）；降级或 PENDING（长期记忆→合理默认、跨会话回放→会话内复盘、门禁→单次评测跑通、多模态不做）。明确「证据绑定与解释性对话仅需内存 trace，不降级」。
  - 架构与复用清单：对话层新增 `dialog.js`/`intake.js`/`POST /api/agent/dialog`，规划/改行程/多方案/解释全部复用现有 `buildAgentPlanPayload`、`POST /api/agent/replan`、`compareStrategies`、`scoreRouteDetailed`、内存 `tracer`、`metrics.js`。
  - 对话-规划双状态机（greet→gather→clarify→confirm→present→refine），澄清预算默认 6、必填=目的地+景点+天数、其余合理默认。
  - 对话维度埋点（`dialog_turn`/`constraint_extract`/`clarify`/`dialog_refine`/`evidence_ref`，schema 拟升 2.0.0，内存态）。
  - 分阶段 P1–P7、降级版 DoD 验收、测试计划（`tests/intake.test.js`/`tests/dialog.test.js`）、风险（对话放大幻觉/过度澄清/无记忆/key 安全）。
- 变体 B（接外部托管存储一并解锁记忆+落盘+回放+门禁 = 100% 终态）暂缓，待变体 A 落地后评估。

修改时间：2026-08-14 14:20 (UTC+8)

## 2026-08-14（v2.0 变体 A 首版落地）

按 [`内测-v2.0-实施方案.md`](./内测-v2.0-实施方案.md) 实现「对话式规划（内存态）」，版本升至 **v2.0.0**（schema 2.0.0）。

- **新增 `intake.js`（约束抽取/草稿管理，纯函数为主）**：`emptyDraft`/`parseExtraction`（校验裁剪 LLM 抽取，非法即抛不静默）/`mergeConstraints`（增量合并、列表去重、标量覆盖、不可变）/`missingRequired`+`isRequiredComplete`（必填=目的地+景点+天数）/`decideClarify`（澄清预算默认 6）/`applyDefaults`（策略/出行/体力/时长默认 + 假设说明）/`groupDestinations`+`buildPlanInputFromDraft`（草稿→现有 plan 层级入参）/`extractConstraints`（注入式 LLM 调用，便于单测）。安全边界：绝不抽取/记录任何 API key/Base URL/model。
- **新增 `dialog.js`（对话决策层，纯函数无副作用）**：`buildGreeting`/`buildConfirmSummary`/`runDialogTurn`（依据 状态+草稿+澄清计数+是否确认+是否已有规划，决策 ask/confirm/present/refine；确认但必填仍缺则回退澄清）。抽取与规划的副作用留在 server 侧，保证可单测、不依赖网络。
- **`tracer.js`**：新增 5 类对话事件 `dialog_turn`/`constraint_extract`/`clarify`/`dialog_refine`/`evidence_ref`（均内存态），`SCHEMA_VERSION` 升至 **2.0.0**。
- **`server.js`**：新增 `extractJsonObject`（稳健提取 JSON，兼容围栏/裸括号）、`callLlmChatJson`（一次性对话 JSON，供抽取复用并计 token）、`buildAgentDialogPayload`（编排：抽取→合并→决策→复用 `buildAgentPlanPayload`/`buildAgentReplanPayload`；无状态友好，草稿/历史/状态由前端逐轮回传；API key 仅服务端使用不进对话上下文）、`handleAgentDialog` 与路由 `POST /api/agent/dialog`（走既有限流）。
- **前端**：`index.html` 版本升 v2.0 + 新增对话面板（浮层：消息流/输入/发送/「确认并规划」/关闭）；`styles.css` 新增面板样式；`app.js` 新增对话客户端（会话状态逐轮回传、打字指示、`fillFormFromDraft` 自动回填左侧表单以保证透明性、`applyDialogPlanResult` 复用 `renderAgentRoadbook`/`renderRouteOnMap` 出路书并保存局部重算上下文）。
- **测试**：新增 `tests/intake.test.js`（11 例：抽取裁剪/合并去重不可变/必填/澄清预算/默认/草稿分组/注入抽取/无静默失败）、`tests/dialog.test.js`（8 例：ask/confirm/present/refine/确认回退/预算耗尽转确认/确认语）、`tracer.test.js` 增对话事件与 schema 2.0.0 断言。全量 **193/193** 通过；greet 端点线上冒烟通过。
- **PENDING（承接 §0）**：跨会话记忆、对话回放、baseline 门禁仍待持久化存储；P4 证据解释话术、P5 多方案对话为下一步增量。

修改时间：2026-08-14 14:45 (UTC+8)
