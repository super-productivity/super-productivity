# ---- Builder stage ----
FROM node:22-alpine AS builder

WORKDIR /repo

RUN apk add --no-cache openssl libc6-compat

# Upgrade npm to match lockfile version (npm 11)
RUN npm install -g npm@11

# Root package + lock (for workspace install)
COPY package.json package-lock.json ./
COPY packages/shared-schema/package.json ./packages/shared-schema/
COPY packages/super-sync-server/package.json ./packages/super-sync-server/

# Install ALL dependencies for the monorepo
RUN npm ci --ignore-scripts

# Copy source code
COPY packages/shared-schema/ ./packages/shared-schema/
COPY packages/super-sync-server/ ./packages/super-sync-server/

# Build shared-schema
WORKDIR /repo/packages/shared-schema
RUN npm run build
# Pack shared-schema to tgz for installation in production
RUN npm pack

# Build super-sync-server
WORKDIR /repo/packages/super-sync-server
RUN npx prisma generate
RUN rm -rf dist && npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS production

# System deps for Prisma & healthcheck + create user BEFORE copying files
RUN apk add --no-cache openssl libc6-compat wget && \
    addgroup -g 1001 -S nodejs && \
    adduser -S supersync -u 1001 -G nodejs && \
    mkdir -p /app/data && chown supersync:nodejs /app /app/data

WORKDIR /app

# Copy built artifacts from builder (note: tsconfig rootDir is "." so structure is dist/src/ and dist/scripts/)
COPY --from=builder --chown=supersync:nodejs /repo/packages/super-sync-server/dist ./dist
COPY --from=builder --chown=supersync:nodejs /repo/packages/super-sync-server/public ./public
COPY --from=builder --chown=supersync:nodejs /repo/packages/super-sync-server/prisma ./prisma
COPY --from=builder --chown=supersync:nodejs /repo/packages/super-sync-server/scripts ./scripts
COPY --from=builder --chown=supersync:nodejs /repo/packages/super-sync-server/src ./src
COPY --from=builder --chown=supersync:nodejs /repo/packages/super-sync-server/package.json ./package.json
COPY --from=builder --chown=supersync:nodejs /repo/packages/shared-schema/sp-shared-schema-*.tgz ./shared-schema.tgz

# Install dependencies and generate Prisma client in single layer
RUN npm install ./shared-schema.tgz --ignore-scripts && \
    npm install --ignore-scripts --omit=dev && \
    npx prisma@5.22.0 generate && \
    rm -f shared-schema.tgz && \
    npm cache clean --force

USER supersync

EXPOSE 1900

ENV NODE_ENV=production
ENV PORT=1900
ENV DATA_DIR=/app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/src/index.js"]