FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN npm install --global pnpm@11.9.0

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN pnpm exec tsc --noEmit && pnpm exec vite build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    LOGOS_DB_PATH=/app/data/logos.db

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

RUN mkdir -p /app/data \
    && printf '{"name":"LOGOS Continuity Public Judge Deployment","installRequired":false,"localSafeMode":true}\n' > /app/portable-build.json \
    && chown -R node:node /app

USER node
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--env-file-if-exists=.env.local", "server/index.ts"]
