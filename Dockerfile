# ==================== 构建阶段 ====================
FROM node:22-alpine AS builder

WORKDIR /app

# 复制依赖文件
COPY package*.json ./
RUN npm ci

# 复制源码
COPY . .

# 占位环境变量（构建时使用）
ENV PUBLIC_MOCK_BASE_URL=https://mock.invalid 
# 构建项目
RUN npm run build

# ==================== 生产阶段 ====================
FROM node:22-alpine

WORKDIR /app

# 只复制构建产物和依赖
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# 暴露端口（SvelteKit默认3000）
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 启动应用
CMD ["node", "build/index.js"]