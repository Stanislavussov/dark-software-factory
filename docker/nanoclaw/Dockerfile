FROM node:24-slim

ARG OPENCODE_INSTALL_URL="https://opencode.ai/install"
ARG PNPM_VERSION="10.33.0"

ENV DEBIAN_FRONTEND=noninteractive
ENV CI=true
ENV PNPM_HOME="/pnpm"
ENV PATH="/root/.opencode/bin:/opt/opencode/bin:${PNPM_HOME}:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    gnupg \
    openssh-client \
    tini \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && . /etc/os-release \
  && printf '%s\n' "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    docker-ce-cli \
    docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

RUN mkdir -p /opt/opencode/bin /opt/nanoclaw-lite /workspace /data /logs

RUN if [ -n "${OPENCODE_INSTALL_URL}" ]; then \
      curl -fsSL "${OPENCODE_INSTALL_URL}" | bash -s -- --no-modify-path; \
    else \
      printf '%s\n' "OPENCODE_INSTALL_URL build arg is required for a production image." >&2; \
      exit 1; \
  fi \
  && ln -sf /root/.opencode/bin/opencode /usr/local/bin/opencode

COPY runtime/nanoclaw-lite/ /opt/nanoclaw-lite/
COPY docker/nanoclaw/entrypoint.sh /usr/local/bin/nanoclaw-entrypoint
COPY docker/nanoclaw/superpowers /opt/nanoclaw/superpowers

RUN if [ -f /opt/nanoclaw-lite/package.json ]; then \
      cd /opt/nanoclaw-lite \
      && pnpm install --frozen-lockfile \
      && pnpm build; \
    fi \
  && chmod +x /usr/local/bin/nanoclaw-entrypoint

WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nanoclaw-entrypoint"]
CMD ["nanoclaw-lite"]
