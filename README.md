# 旅行规划 Agent

当前版本：**内测 v1.1.0**（已锁定，详见 [`doc_auto/内测-v1.1.0.md`](doc_auto/内测-v1.1.0.md)）

本地可运行的旅行路线规划原型：支持多目的地层级输入、酒店锚点、地图标点与 Agent 智能路书。

## 两种使用模式

| 模式 | 依赖 | 做什么 |
|------|------|--------|
| **地图标点** | 仅 Google Maps API | 按输入顺序在地图上标 1、2、3…，并展示各景点具体位置 |
| **智能路书** | Google Maps + LLM（默认通义千问） | Agent 分析景点、规划顺序、生成路书与注意事项，并画推荐路线 |

## 功能概览

- **层级输入**：国家/城市/点位三级结构，支持动态添加与删除
- **点位类型**：每行可选景点/酒店，默认景点，酒店作为可选锚点
- **地图标点**：无 LLM 时的核心能力，修复了多景点重叠到城市中心的问题
- **Agent 智能路书**：LLM + Google Maps 工具（地理编码、真实车程）
- **智能路书展示**：概述、路线策略、住宿摘要、按日路书、校验结果与替代方案
- **LLM 供应商识别**：默认 DashScope（Qwen），兼容 OpenAI 等

## 快速开始

1. 启动服务：

```bash
node server.js
```

2. 打开 `http://127.0.0.1:8080/index.html`

3. **地图标点（无需 LLM）**
   - 填 Google Maps API Key → 连接地图
   - 填层级目的地与点位（可选一个酒店锚点）→ 点击「在地图上标点」

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
node --test tests/planner.test.js tests/llm.test.js tests/agent-planner.test.js tests/location-data.test.js
```

## 版本文档

- 内测基线：[`doc_auto/内测-v1.0.md`](doc_auto/内测-v1.0.md)
- 内测发布：[`doc_auto/内测-v1.1.0.md`](doc_auto/内测-v1.1.0.md)
- 下一版本规划（草案）：[`doc_auto/内测-v1.1-改进规划.md`](doc_auto/内测-v1.1-改进规划.md)
- 变更记录：[`doc_auto/changes.md`](doc_auto/changes.md)
