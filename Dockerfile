# 旅行规划 Agent · 内测 v1.2 生产镜像
FROM node:20-alpine

WORKDIR /app

# 本项目为零运行时依赖（仅 Node 内置模块），仅复制 manifest 以复用构建缓存
COPY package.json ./

# 复制应用源码
COPY . .

ENV HOST=0.0.0.0 \
    PORT=8080 \
    NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
