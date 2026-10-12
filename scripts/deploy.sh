#!/bin/sh
# Rebuild and restart the site from the checked-out commit: scripts/deploy.sh
# Run on the VPS after `git pull`. The release inside the image is reproducible, so text that
# hasn't changed keeps its hashed file names (and readers' cached copies).
set -eu
cd "$(dirname "$0")/.."
SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
GIT_COMMIT=$(git rev-parse --short HEAD)
export SOURCE_DATE_EPOCH GIT_COMMIT
docker compose build
docker compose up -d
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
echo "deployed $GIT_COMMIT"
