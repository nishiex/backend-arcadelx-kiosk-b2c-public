FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages

RUN npm ci

ARG BACKEND_API_URL=http://api:4000
ENV BACKEND_API_URL=$BACKEND_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build --workspace=web

FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV BACKEND_API_URL=http://api:4000

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
