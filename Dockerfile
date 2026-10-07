FROM node:24-slim AS build
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:24-alpine AS production
WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/src/docs ./src/docs

# Security: non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 6200

CMD ["node", "dist/server.js"]
