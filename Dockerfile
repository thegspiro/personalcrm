# syntax=docker/dockerfile:1

###############################################################################
# Personal CRM — single-container image with MariaDB bundled in.
#
# Everything persistent lives under /config, which is the only volume Unraid
# needs to map:
#   /config/db            MariaDB data directory
#   /config/uploads       avatars and photos
#   /config/backups       nightly mariadb-dump output
#   /config/secrets.json  generated on first boot (auth secret + db password)
#
# Set DATABASE_URL to point at an existing MariaDB/MySQL server and the bundled
# instance is skipped entirely.
#
# Ubuntu LTS base, matching the LinuxServer.io images most Unraid users already
# run, with Node installed from the official nodejs.org build.
###############################################################################

ARG UBUNTU_VERSION=24.04
ARG NODE_VERSION=22.22.2
ARG S6_OVERLAY_VERSION=3.2.0.2

# --- base: Ubuntu + Node, shared by every stage so the Prisma engine built at
#     build time is the one that runs at runtime ---------------------------
FROM ubuntu:${UBUNTU_VERSION} AS base
ARG NODE_VERSION
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils; \
    case "${TARGETARCH:-amd64}" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"; \
    curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"; \
    grep " node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz\$" SHASUMS256.txt | sha256sum -c -; \
    tar -xJf "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -C /usr/local --strip-components=1 \
        --no-same-owner --exclude CHANGELOG.md --exclude LICENSE --exclude README.md; \
    rm -f "node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" SHASUMS256.txt; \
    node --version; npm --version; \
    rm -rf /var/lib/apt/lists/*

# --- deps: install node modules once, cached on the lockfile -----------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- prisma-cli: the migrate CLI with its full dependency tree ---------------
# `prisma migrate deploy` runs at container start. Copying node_modules/prisma
# alone leaves its transitive dependencies behind, so install it standalone,
# pinned to the exact version the lockfile resolved for the generated client.
FROM base AS prisma-cli
WORKDIR /prisma-cli
COPY package.json package-lock.json ./
RUN set -eux; \
    VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")"; \
    echo "installing prisma CLI ${VERSION}"; \
    rm -f package.json package-lock.json; \
    npm init -y >/dev/null; \
    npm install --no-audit --no-fund --omit=dev "prisma@${VERSION}"

# --- builder: generate the Prisma client and build Next in standalone mode ---
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate \
 && npm run build

# --- runtime -----------------------------------------------------------------
FROM base AS runtime
ARG S6_OVERLAY_VERSION
ARG TARGETARCH

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PUID=99 \
    PGID=100 \
    UPLOADS_DIR=/config/uploads \
    TZ=Etc/UTC \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_KEEP_ENV=1 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        mariadb-server \
        mariadb-client \
        tzdata \
        procps \
        gzip; \
    # The image ships no database of its own — /config/db is created on first run.
    rm -rf /var/lib/mysql /etc/mysql/mariadb.conf.d/50-server.cnf; \
    # PAM auth is never used here and its setuid helper cannot be chowned in an
    # unprivileged container, which makes mariadb-install-db noisy.
    rm -rf /usr/lib/mysql/plugin/auth_pam*.so /usr/lib/mysql/plugin/auth_pam_tool_dir; \
    mkdir -p /run/mysqld; \
    rm -rf /var/lib/apt/lists/*

# s6-overlay supervises MariaDB and the app in one container and orders startup.
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) S6_ARCH=x86_64 ;; \
      arm64) S6_ARCH=aarch64 ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl -fsSL -o s6-noarch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz"; \
    curl -fsSL -o s6-arch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz"; \
    tar -C / -Jxpf s6-noarch.tar.xz; \
    tar -C / -Jxpf s6-arch.tar.xz; \
    rm -f s6-noarch.tar.xz s6-arch.tar.xz

# s6 puts its own tools on PATH for the services it supervises, and a
# `docker exec` gets this PATH instead. Without /command on it, running the
# on-demand backup from outside fails: first because s6-setuidgid is not
# found, and then — named by its absolute path — because the execline script
# it is cannot find `ifelse`. Both are here.
ENV PATH="/command:${PATH}"

WORKDIR /app

# Next's standalone bundle: server.js plus only the modules it actually traced.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Schema, migrations, and the generated client (Next traces it, but the query
# engine binary is easy to miss, so copy it explicitly).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# The migrate CLI, kept out of the app's own module tree.
COPY --from=prisma-cli /prisma-cli /app/prisma-cli

COPY docker/mariadb.cnf /etc/mysql/personalcrm.cnf
COPY root/ /

RUN chmod -R +x /etc/s6-overlay/s6-rc.d /etc/s6-overlay/scripts

VOLUME ["/config"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/init"]
