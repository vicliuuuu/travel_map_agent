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
