FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY web ./web
COPY server ./server
RUN npm run build:web && npm run build:server && cp server/fallback/snapshot.json.gz dist/server/fallback/

FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY data ./data
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 8080
# JS ya compilado (tsc): arranca sin transpilar en frío.
CMD ["node", "dist/server/index.js"]
