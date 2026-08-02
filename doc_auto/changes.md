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
