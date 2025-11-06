# Multi-stage Dockerfile for AgentHunt Backend
# Automatically handles: npm install, npm build, and running the app

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy backend source
COPY backend/ ./

# Build TypeScript to JavaScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Install production dependencies only
COPY backend/package*.json ./
RUN npm ci --only=production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Copy any additional required files
COPY backend/src/models ./src/models

# Install curl for healthchecks
RUN apk add --no-cache curl

# Expose port
EXPOSE 3000

# Default command (can be overridden)
CMD ["node", "dist/index.js"]
