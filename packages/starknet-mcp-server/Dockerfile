FROM node:22-alpine
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy manifests for dependency install
COPY package.json pnpm-lock.yaml* ./

# Production-only install (no devDependencies)
RUN pnpm install --frozen-lockfile --prod 2>/dev/null || pnpm install --prod

# Copy compiled output
COPY dist/ ./dist/

# Expose HTTP port
EXPOSE 3002

# Default: HTTP mode
CMD ["node", "dist/http-server.js"]
