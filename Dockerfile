# Build stage
FROM --platform=$BUILDPLATFORM node:20 AS build

# Accept build arguments for environment variables with defaults
ARG UNSPLASH_KEY=DUMMY_UNSPLASH_KEY
ARG UNSPLASH_CLIENT_ID=DUMMY_UNSPLASH_CLIENT_ID

# Set as environment variables for the build
ENV UNSPLASH_KEY=$UNSPLASH_KEY
ENV UNSPLASH_CLIENT_ID=$UNSPLASH_CLIENT_ID

WORKDIR /app

# Install git and configure for HTTPS
# Use single apt-get command to avoid GPG issues
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y \
    --no-install-recommends \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global url."https://github.com/".insteadOf ssh://git@github.com/

# Copy and install dependencies
COPY package*.json ./
COPY packages/plugin-api/package*.json ./packages/plugin-api/
COPY packages/plugin-api/tsconfig.json ./packages/plugin-api/
COPY packages/plugin-api/src ./packages/plugin-api/src
COPY packages/shared-schema/package*.json ./packages/shared-schema/
COPY packages/shared-schema/tsconfig.json ./packages/shared-schema/
COPY packages/shared-schema/tsup.config.ts ./packages/shared-schema/
COPY packages/shared-schema/src ./packages/shared-schema/src
COPY tsconfig.json ./
RUN npm ci --ignore-scripts || npm i --ignore-scripts
RUN npm run prepare

# Copy source and build
COPY . .
# Pass build args as environment variables for the build commands
RUN UNSPLASH_KEY=$UNSPLASH_KEY UNSPLASH_CLIENT_ID=$UNSPLASH_CLIENT_ID npm run env && npm run lint && npm run buildFrontend:prodWeb

# Production stage
FROM nginx:1

ENV APP_PORT=80

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends jq curl && rm -rf /var/lib/apt/lists/*

# Copy built app and configs
COPY --from=build /app/dist/browser /usr/share/nginx/html
COPY ./nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY ./docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE $APP_PORT
WORKDIR /usr/share/nginx/html

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
