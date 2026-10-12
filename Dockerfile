# The distribution site: every standard build (made when the image is built, content-hashed)
# and the custom-build server. See README.md, "Deploying".
#
#   docker build \
#     --build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct) \
#     --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
#     -t patimokkha .
#
# SOURCE_DATE_EPOCH makes the PDFs and EPUBs reproducible, so unchanged text keeps its file names.

ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION}-debian AS bun

# Debian 13: pandoc 3 (for --split-level), LuaLaTeX, Gentium Plus, fonttools for the web font subset.
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates fontconfig fonts-sil-gentiumplus \
      texlive-luatex texlive-latex-recommended texlive-latex-extra \
      pandoc zip python3-fonttools python3-brotli \
 && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --chown=app:app package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile --production
COPY --chown=app:app content content
COPY --chown=app:app src src
COPY --chown=app:app assets assets
COPY --chown=app:app data data
RUN mkdir -p dist/cache && chown -R app:app /app

# Build as the user that serves, so LuaLaTeX's font cache is already warm for custom builds.
USER app
ARG SOURCE_DATE_EPOCH
ARG GIT_COMMIT
RUN SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH} GIT_COMMIT=${GIT_COMMIT} bun run release

ENV PORT=3000 HOST=0.0.0.0
EXPOSE 3000
VOLUME /app/dist/cache
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD bun -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "src/serve.ts"]
