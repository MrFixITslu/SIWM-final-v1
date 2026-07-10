# Single-container production image: one Express process serves the API
# and the built frontend on one port, matching this app's other deployments
# behind Nginx Proxy Manager on the shared proxy_network.

# ---- Stage 1: build ----
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY . .
# Produces dist/index.html + dist/assets (vite) and dist/server.cjs (esbuild)
RUN npm run build

# ---- Stage 2: production runtime ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Run as the non-root user already present in the base image, not root.
RUN chown -R node:node /app
USER node

EXPOSE 4001
CMD ["node", "dist/server.cjs"]
