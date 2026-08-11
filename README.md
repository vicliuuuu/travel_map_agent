# 旅行规划 Agent

当前版本：**内测 v1.6.0**（详见 [`doc_auto/内测-v1.6-前瞻规划.md`](doc_auto/内测-v1.6-前瞻规划.md) 与 [`doc_auto/changes.md`](doc_auto/changes.md)）

可本地运行、也可公网部署的旅行路线规划原型：支持多目的地层级输入、酒店锚点、地图标点与 Agent 智能路书；v1.2 引入策略引擎、跨城公共交通分段与酒店闭环硬约束，v1.3 把隐式流程升级为「显式状态机 + 自动修复闭环」并建立全链路 trace 埋点基线，v1.4 升级为「策略引擎（多策略打分 + 候选剪枝 + 打分兜底）」并根治 OI-1 跨城分天，v1.5 把工具层扩展为「可插拔多事实源」（营业时间/天气/拥堵）并把校验层扩展到「闭馆风险/体力强度/回酒店往返成本」，v1.6 把景点与酒店分离输入并支持「多酒店/换酒店按日闭环」、支持「局部重算（改一个点只重算受影响天）」、并把天数估算重做为「逐日装箱 + 单日预算随体力强度联动」。

## 两种使用模式

| 模式 | 依赖 | 做什么 |
|------|------|--------|
| **地图标点** | 仅 Google Maps API | 按输入顺序在地图上标 1、2、3…，并展示各景点具体位置 |
| **智能路书** | Google Maps + LLM（默认通义千问） | Agent 分析景点、规划顺序、生成路书与注意事项，并画推荐路线 |

## 功能概览

- **层级输入**：国家/城市/点位三级结构，支持动态添加与删除
- **景点/酒店分离输入（v1.6）**：景点列表只填景点；酒店独立管理，可填多家并各带入住/离店日期（酒店仍为可选，保护隐私）
- **地图标点**：无 LLM 时的核心能力，修复了多景点重叠到城市中心的问题；多酒店时逐家标记（H1/H2…）
- **Agent 智能路书**：LLM + Google Maps 工具（地理编码、真实车程）
- **策略引擎（v1.2）**：省时优先 / 少换乘优先 / 经典打卡优先，后端打分器在模型建议与策略候选中择优并解释
- **跨城公共交通分段（v1.2）**：对跨城相邻段调用 Google Directions `transit`，输出步行/轨交/换乘分段时长，替代“请以实时导航为准”
- **酒店闭环硬约束（v1.2）**：有酒店锚点时每日首段从酒店出发、末段返回酒店，无法闭环时给出告警
- **显式状态机（v1.3）**：`build_context → plan_initial → verify → repair → finalize / fallback` 由统一调度器驱动，含非法跳转与环路防护
- **自动修复闭环（v1.3）**：结构化校验器（超载/跨城冲突/闭环断裂/空天）触发修复动作库（拆天/删点/换序/并天），带轮次上限、无改善阈值与保底回退
- **全链路 trace 埋点（v1.3）**：state_enter/exit、tool_call、validation、repair_action、fallback 统一 schema 落地，`GET /api/debug/last-trace` 可复盘（内测）
- **策略引擎升级（v1.4）**：统一打分器（度量归一化 + 得分构成）+ 多路候选生成与剪枝（上限 K，防组合爆炸）+ 打分器主导排序；结构化 `strategyExplanation`（含次优对比与 scoreGap）与 A/B 策略对比 `strategyComparison`（用户策略 vs 次优策略）
- **OI-1 分天根治（v1.4）**：cluster-then-assign 全局按城市聚类分天（任意策略下同城同日、消除无谓跨城）+ 按日分组口径跨城统计（`routeMetrics.crossCityByDay`）
- **交通模式偏好（v1.4）**：请求体 `transportPreference: driving|transit|walking` 以权重乘子接入打分（driving 为默认）
- **埋点扩展（v1.4）**：新增 strategy_select / scoring / alternative_compare 事件，trace schema 升至 1.4.0
- **可插拔工具层（v1.5）**：统一 `Tool` 抽象 + `ToolRegistry`（幂等缓存/超时重试/错误码标准化/三级降级/来源标注），`opening_hours`（provider: google_places）/`weather`/`congestion` 按开关热插拔；`opening_hours`/`congestion` 默认开启、`weather` 默认关闭，失败自动降级不影响主流程（`tools.js`）
- **营业时间展示（v1.5.2+）**：每个景点卡片下展示「营业：HH:MM–HH:MM · 来源 Google Places」（已核实）或「未获取（未核实）」，自证外部事实来源；`opening_hours` 查询以「名称 + 城市/国家」消歧、规范地址兜底，显著降低 `ZERO_RESULTS`
- **校验层扩展（v1.5）**：`OPENING_RISK`（时间轴推算到达时刻判闭馆，未核实降级 warn）/`PHYSICAL_OVERLOAD`（单日体力强度）/`HOTEL_RETURN_COST`（回酒店往返成本），闭馆风险联动 `advance_place` 修复动作
- **来源标注与降级（v1.5）**：外部事实统一带 `source/fetchedAt/verifyState`，工具不可用时 skip/conservative/fatal 分级降级（不静默），trace schema 升至 1.5.0（新增 fact_source / tool_degrade）
- **全链路审计修复（v1.5.2+）**：外部事实工具并发化 + 超时放宽（压延迟/防限流）、用户级 `visitMinutes` 时长兜底生效、交付前重打分使策略解释与展示指标同源、缺城市元数据不再虚增跨城计数
- **多酒店 / 换酒店按日闭环（v1.6）**：可填多家酒店（各带入住/离店日期），按日期映射每天所属酒店；换酒店日在当天首段插入「行李转移」腿，空档日退化为无酒店闭环并提醒；`lodgingSummary` 输出全部酒店，地图逐家标记
- **局部重算 Incremental Replan（v1.6）**：按日行程中「删除某点 / 移到第 N 天」只重算受影响天，未受影响天逐字节复用，纯本地重算（不重调 LLM/地图 API），回执显示「仅重算第 X 天、复用 Y%」；后端 `POST /api/agent/replan`
- **天数估算重做 + 体力强度联动（v1.6）**：从「单链平均通勤/写死 10h」改为「逐日装箱取最小可行天数」——每天须同时满足纯游玩（含 0.1 疲劳、每天重置）≤ 体力档位上限、景点数 ≤ 上限、且「游玩+通勤+当天酒店往返」≤ **随体力强度缩放的单日预算（轻松 8h / 标准 10h / 硬核 12h）× 85% 冗余**；通勤走混合口径（真实车程缓存优先 + 坐标 haversine 兜底，零额外 API）。体力强度自此真正影响「该排几天」
- **按城市软对齐分天（v1.6）**：分天切在城市边界上（一天尽量一城），天数不足时合并「点数之和最小」的相邻城市段，避免把同城拆两天/无谓跨城
- **智能路书展示**：概述、路线策略、住宿摘要、按日路书、校验结果与替代方案
- **LLM 供应商识别**：默认 DashScope（Qwen），兼容 OpenAI 等
- **公网部署（v1.2）**：Docker/环境变量/CORS/限流，密钥可后端环境变量兜底（详见 [`deploy.md`](deploy.md)）

## 快速开始

1. 启动服务：

```bash
node server.js
```

2. 打开 `http://127.0.0.1:8080/index.html`

3. **地图标点（无需 LLM）**
   - 填 Google Maps API Key → 连接地图
   - 填层级目的地与景点，并在「住宿」区可选填一家或多家酒店 → 点击「在地图上标点」

4. **智能路书（需要 LLM）**
   - 完成上述配置
   - 填 LLM API Key（默认已配置通义千问 Base URL 与 `qwen-plus`）
   - 点击「Agent 智能规划（LLM + Google Maps）」
   - 在右侧查看智能路书，地图上查看推荐路线

## Google Maps API Key

1. [Google Cloud Console](https://console.cloud.google.com/)
2. 启用：**Maps JavaScript API**、**Geocoding API**、**Directions API**
3. 创建 API Key 并填入页面

## 通义千问 API Key（推荐）

1. [DashScope 控制台](https://dashscope.console.aliyun.com/)
2. 开通服务 → [API-KEY 管理](https://dashscope.console.aliyun.com/apiKey) → 创建 Key
3. 页面填写：
   - Base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`
   - Model：`qwen-plus`

## Agent 规划说明

后端 `POST /api/agent/plan` 让 LLM 在提示词约束下：

1. 支持 `destinations` 点位结构输入（含可选酒店锚点）
2. 调用 Google Maps 工具获取景点/酒店真实位置与车程
3. 输出 `dailyPlans`（酒店闭环）、`validation`（错城/超载）与替代方案
4. 按「尽量不走回头路」生成时间段路书（非精确时刻）

提示词源码：`llm.js` → `buildAgentSystemPrompt()` / `buildAgentUserPrompt()`

## 测试

```bash
node --test tests/planner.test.js tests/llm.test.js tests/agent-planner.test.js tests/location-data.test.js tests/verifier.test.js tests/repair.test.js tests/state-machine.test.js tests/tracer.test.js tests/day-plan.test.js tests/scoring.test.js tests/tools.test.js tests/multi-hotel.test.js tests/replan.test.js tests/day-estimate.test.js
```

或直接 `npm test`（已包含全部测试文件，v1.6 全量 **159** 例）。

## v1.5 工具/校验开关（环境变量）

`opening_hours`/`congestion` **默认开启**、`weather` **默认关闭**（原因见下表）。`opening_hours`/`weather` 走 Google API（需对应权限），失败/地区不覆盖时自动降级并标注「未核实」，主流程不中断。`congestion` 默认走内置高峰启发式，无需额外 API。

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `OPENING_HOURS_ENABLED` | `true` | 营业时间工具（provider: google_places，需 **Places API** 权限），供闭馆风险校验 |
| `WEATHER_ENABLED` | `false` | 天气工具（provider: **Google Weather API**）。默认关闭：当前流程未采集实际出行日期，预报只能取"最近一天"意义不大。设 `true` 后**仅当填写入住日期**才会查询并并入注意事项 |
| `CONGESTION_ENABLED` | `true` | 拥堵修正（内置高峰时段启发式：早/晚高峰放大通勤时长，作用于闭馆判定） |
| `PHYSICAL_CHECK_ENABLED` | `true` | 单日体力强度校验（warn，纯计算，阈值由请求体 `physicalPreference` 决定） |
| `HOTEL_RETURN_CHECK_ENABLED` | `true` | 回酒店往返成本校验（warn，纯计算，>35% 提醒） |
| `DAY_START_MIN` | `540` | 每日出发基准时刻（分钟，默认 09:00），用于到达时刻推算 |
| `TOOL_FETCH_CONCURRENCY` | `5` | 外部事实工具（营业时间/天气）并发拉取上限（并发压延迟 + 限流防撞配额） |
| `OPENING_HOURS_TIMEOUT_MS` | `9000` | 营业时间单次调用超时（含 findplace+details 两跳，勿设过小以免误判降级） |
| `WEATHER_TIMEOUT_MS` | `6000` | 天气单次调用超时 |
| `OPENING_HOURS_SCOPE` | `all` | `all`=全部景点查营业时间；`high`=仅高优先级景点（省调用/省钱） |

请求体新增可选字段：`physicalPreference: easy \| standard \| hardcore`（默认 `standard`），对应单日体力强度阈值 5h/4景点、7h/6景点、9h/8景点；前端「体力强度偏好」下拉可选。**v1.6 起该档位还决定单日总时长预算（轻松 8h / 标准 10h / 硬核 12h，另留 15% 时间冗余），直接影响天数估算与超载判定**——即体力强度真正影响「该排几天」，不再与写死的 10h 脱钩。`visitMinutes`（每个景点默认游玩时长，分钟）现已生效：仅对模型未给出建议时长的景点作兜底（clamp 30~480）。

> 注意：`opening_hours` 需在 Google Cloud 启用 **Places API（经典版）**，`weather` 需启用 **Weather API**，并把它们加入该 key 的 API 限制允许列表。

## 公网部署

见 [`deploy.md`](deploy.md)。核心：纯 Node 内置模块（无需 `npm install`），`node server.js` 即可；Docker 一键构建，环境变量支持 CORS 白名单、限流与密钥后端兜底。

## 版本文档

- 内测基线：[`doc_auto/内测-v1.0.md`](doc_auto/内测-v1.0.md)
- 内测发布：[`doc_auto/内测-v1.1.0.md`](doc_auto/内测-v1.1.0.md)
- v1.2 规划与实现：[`doc_auto/内测-v1.2-改进规划.md`](doc_auto/内测-v1.2-改进规划.md)
- v1.3 规划与实现：[`doc_auto/内测-v1.3-前瞻规划.md`](doc_auto/内测-v1.3-前瞻规划.md)
- v1.4 规划与实现：[`doc_auto/内测-v1.4-前瞻规划.md`](doc_auto/内测-v1.4-前瞻规划.md)
- v1.5 规划与实现：[`doc_auto/内测-v1.5-前瞻规划.md`](doc_auto/内测-v1.5-前瞻规划.md)
- v1.6 规划与实现：[`doc_auto/内测-v1.6-前瞻规划.md`](doc_auto/内测-v1.6-前瞻规划.md)
- 变更记录：[`doc_auto/changes.md`](doc_auto/changes.md)
