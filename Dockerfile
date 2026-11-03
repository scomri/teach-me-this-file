FROM node:24.22.2 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
COPY shared ./shared
RUN npm run build

FROM node:24.22.2-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# Root-owned, read-only for the runtime user.
COPY server ./server
COPY shared ./shared
COPY --from=build /app/client/dist ./client/dist
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
