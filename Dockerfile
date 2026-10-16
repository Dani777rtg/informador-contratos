FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm install --no-save tsx@4

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY server ./server
COPY data ./data
USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server/index.ts"]
