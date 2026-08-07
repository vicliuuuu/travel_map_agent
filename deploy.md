# 部署指南（内测 v1.2 公网化）

本项目为**零运行时依赖**的 Node 服务（仅使用 Node 内置模块），既托管前端静态资源，也提供 Agent 规划接口，可直接部署到任意支持 Node ≥ 18 的平台。

## 1. 环境变量

复制 `.env.example` 为 `.env` 并按需填写。关键项：

| 变量 | 说明 | 默认 |
|------|------|------|
| `HOST` | 监听地址，容器内建议 `0.0.0.0` | `127.0.0.1` |
| `PORT` | 监听端口 | `8080` |
| `ALLOWED_ORIGINS` | CORS 白名单（逗号分隔），留空表示允许所有来源 | 空 |
| `RATE_LIMIT_WINDOW_MS` | 限流时间窗（毫秒） | `60000` |
| `RATE_LIMIT_MAX` | 单 IP 时间窗内最大请求数，`0` 关闭限流 | `30` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | LLM 密钥后端兜底（前端未传时生效） | 空 |
| `MAPS_API_KEY` | Google Maps 密钥后端兜底（前端未传时生效） | 空 |

> 密钥策略：当前保持 **keep 模式**——前端仍可传入 key；仅当请求未携带 key 时才回退到环境变量。若要完全后端托管，请在前端留空并在环境变量中配置。

## 2. 本地运行

```bash
node server.js
# 浏览器打开 http://127.0.0.1:8080/index.html
```

## 3. Docker 部署

```bash
docker build -t travel-map-agent:1.2 .
docker run --rm -p 8080:8080 --env-file .env travel-map-agent:1.2
```

## 3.5 免费平台推荐（2026 现状）

> 免费额度经常调整，以下为 2026 年现状摘要，部署前请再确认平台最新政策。

| 平台 | 是否真免费 | 规格 | 关键限制 | 适合 |
|------|-----------|------|----------|------|
| **Render**（最省心） | ✅ 750 小时/月 | 512MB / 0.1 CPU | 闲置 15 分钟休眠，冷启动 30–60s；需绑卡（不扣费） | 首选，内测 Demo |
| **Koyeb** | ✅ 1 个服务常驻 | 512MB / 0.1 CPU | 0.1 vCPU 偏弱；政策近期有变动 | 需要「不休眠」的场景 |
| **Google Cloud Run** | ✅ 200 万请求/月 | 按需 | 需绑卡；serverless 冷启动 | 事件型/低频 API |
| **Oracle Cloud Always Free** | ✅ 永久免费 | 最高 4 OCPU / 24GB | 配置略复杂，是完整 VM | 想要真服务器、算力最强 |
| Railway | ⚠️ 仅 $5 一次性额度 | 1vCPU/0.5GB | 用完转按量计费 | 短期试用 |
| Fly.io | ⚠️ 新账号仅 2 小时试用 | — | 免费层基本取消 | 不推荐做免费长期 |

选择建议：
- **只是想让别人打开链接看 Demo** → 用 **Render 免费 Web Service**（最简单，Docker 或直接 Node 都行，冷启动可接受）。
- **不想休眠 / 要稳定常驻** → **Koyeb**（1 个免费常驻实例）。
- **想要最强免费算力、愿意折腾** → **Oracle Cloud Always Free**（等于送你一台永久免费小服务器）。
- **中国大陆访问友好** → 上述海外平台在国内访问可能不稳定；若面向国内用户，考虑阿里云/腾讯云的轻量应用服务器（有新用户优惠，非永久免费）。

> 注意：本应用需要 Google Maps API，Google Maps 在中国大陆本身访问受限，海外平台 + Google Maps 更适合面向海外用户的场景。

### 用 Render 免费部署（最短路径）

1. 把代码推到 GitHub 仓库；
2. 打开 [render.com](https://render.com) → New → **Web Service** → 连接该仓库；
3. Runtime 选 **Node**，Build Command 留空，Start Command 填 `node server.js`；
4. Instance Type 选 **Free**；
5. Environment 里配置 `HOST=0.0.0.0`、`ALLOWED_ORIGINS=<你的 Render 域名>`，以及（可选）`LLM_API_KEY` / `MAPS_API_KEY`；
6. Deploy，等待生成 `https://<your-app>.onrender.com`。

## 4. 平台部署（Render / Railway / Fly.io / 云 ECS）

通用要点：

1. 构建命令：无（无需 `npm install`，纯内置模块）；
2. 启动命令：`node server.js` 或 `npm start`；
3. 平台环境变量中配置 `HOST=0.0.0.0`、`PORT`（多数平台会注入 `PORT`）、`ALLOWED_ORIGINS`；
4. 生产环境建议开启限流并配置来源白名单；
5. 若使用后端托管密钥，配置 `LLM_API_KEY` / `MAPS_API_KEY` 等。

### Fly.io 参考

```bash
fly launch --no-deploy   # 生成 fly.toml，internal_port 设为 8080
fly secrets set LLM_API_KEY=... MAPS_API_KEY=... ALLOWED_ORIGINS=https://your-app.fly.dev
fly deploy
```

## 5. 上线自检清单

- [ ] `node --test` 全部通过；
- [ ] 设置 `ALLOWED_ORIGINS`，确认跨域被正确放行/拦截；
- [ ] 触发超过 `RATE_LIMIT_MAX` 的请求，确认返回 `429`；
- [ ] `GET /api/strategies` 返回策略列表；
- [ ] 一次完整 Agent 规划（含跨城 transit 分段与酒店闭环）成功返回。
