FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY web ./web
RUN npm run build:web

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
COPY --from=build /app/web/dist ./web/dist
USER node
EXPOSE 8080
# ponytail: se ejecuta con tsx; compilar a JS (tsc) bajaría el arranque en frío, pendiente.
CMD ["node_modules/.bin/tsx", "server/index.ts"]
