FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --no-audit --no-fund
COPY frontend ./frontend
COPY shared ./shared
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DB_PATH=/app/data/lab.db
COPY package*.json ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev --no-audit --no-fund && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/frontend/dist ./frontend/dist
COPY backend ./backend
COPY shared ./shared
COPY scripts ./scripts
COPY licenses ./licenses
COPY THIRD_PARTY.md ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "backend/src/index.js"]
