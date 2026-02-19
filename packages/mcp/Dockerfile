# Build Stage
# NOTE: Run this from the repository ROOT to access workspace packages
# docker build -f packages/mcp/Dockerfile .
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace config files
COPY pnpm-workspace.yaml turbo.json tsconfig.base.json package.json pnpm-lock.yaml ./

# Copy all package.json and tsconfig files for proper workspace resolution
COPY packages/core/package.json packages/core/tsconfig.json packages/core/
COPY packages/soul/package.json packages/soul/tsconfig.json packages/soul/
COPY packages/mcp/package.json packages/mcp/tsconfig.json packages/mcp/
COPY packages/toolkit/package.json packages/toolkit/tsconfig.json packages/toolkit/
COPY packages/defi-bnb/package.json packages/defi-bnb/tsconfig.json packages/defi-bnb/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ packages/
# Adapters merged into packages
# No legacy src/ copy needed

# Build all packages in dependency order
RUN pnpm turbo run build --filter=@clawkit/mcp...

# Production Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/soul/package.json packages/soul/
COPY packages/mcp/package.json packages/mcp/
COPY packages/toolkit/package.json packages/toolkit/
COPY packages/defi-bnb/package.json packages/defi-bnb/

RUN pnpm install --frozen-lockfile --prod && \
    pnpm store prune

# Copy built artifacts
COPY --from=builder /app/packages/core/dist packages/core/dist
COPY --from=builder /app/packages/soul/dist packages/soul/dist
COPY --from=builder /app/packages/toolkit/dist packages/toolkit/dist
COPY --from=builder /app/packages/mcp/dist packages/mcp/dist
COPY --from=builder /app/packages/defi-bnb/dist packages/defi-bnb/dist

# Security
RUN addgroup -S eidolon && adduser -S eidolon -G eidolon
USER eidolon

ENTRYPOINT ["node", "packages/mcp/dist/mcp-server.js"]
