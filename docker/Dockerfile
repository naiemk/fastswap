# Build from the parent of both repos (directory that contains onchain-invoice/ and fastswap/):
#   docker build -f fastswap/docker/Dockerfile -t fastswap .
FROM node:22-bookworm AS build
WORKDIR /src

COPY onchain-invoice/package.json onchain-invoice/package-lock.json ./onchain-invoice/
WORKDIR /src/onchain-invoice
RUN npm ci
COPY onchain-invoice/ ./
RUN npm run build && npm run compile

WORKDIR /src/fastswap
COPY fastswap/package.json fastswap/package-lock.json* ./
RUN npm ci
COPY fastswap/ ./
RUN npm run compile && npm run build

FROM node:22-bookworm-slim
RUN useradd --create-home --uid 1001 fastswap
WORKDIR /app
COPY --from=build /src/fastswap/package.json /src/fastswap/package-lock.json* ./
COPY --from=build /src/onchain-invoice /opt/onchain-invoice
RUN npm ci --omit=dev
COPY --from=build /src/fastswap/dist ./dist
COPY --from=build /src/fastswap/lm-dist ./lm-dist
COPY --from=build /src/fastswap/artifacts ./artifacts
RUN mkdir -p /app/data && chown -R fastswap:fastswap /app
USER fastswap
ENV NODE_ENV=production
CMD ["node", "dist/server/main.js"]
