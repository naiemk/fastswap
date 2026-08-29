FROM node:22-bookworm AS build
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN node scripts/build-onchain-invoice.mjs && npm run compile && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/artifacts ./artifacts
COPY --from=build /app/node_modules/onchain-invoice ./node_modules/onchain-invoice
RUN mkdir -p /app/data /config && useradd --create-home --uid 1001 fastswap && chown -R fastswap:fastswap /app /config
USER fastswap
ENV NODE_ENV=production
EXPOSE 4010
CMD ["node", "dist/server/main.js"]
