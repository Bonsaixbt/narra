# Build the library and the service together; run the service.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY bin ./bin
COPY src ./src
COPY scripts ./scripts
RUN npm ci && npm run build
COPY service/package.json service/tsconfig.json ./service/
COPY service/src ./service/src
RUN cd service && npm install --omit=dev && npm run build

FROM node:22-slim
# a system font for the PNG share cards (resvg renders text only with a font it can find)
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NARRA_DB=/data/narra.db NARRA_MODEL_DIR=/data/models NARRA_API_HOST=0.0.0.0
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 4663
HEALTHCHECK --interval=60s --timeout=10s CMD node -e "fetch('http://127.0.0.1:4663/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "service/dist/src/index.js"]
