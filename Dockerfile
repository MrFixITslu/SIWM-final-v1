# Stage 1: Build the full-stack bundle
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY . .

# Run the build script (compiles frontend via vite and backend via esbuild)
RUN npm run build

# Stage 2: Run the production application
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built assets and server bundles from builder stage
COPY --from=builder /app/dist ./dist

# Expose port 4000 for our full-stack container
EXPOSE 4000

# Start the application using Node.js
CMD ["npm", "run", "start"]
