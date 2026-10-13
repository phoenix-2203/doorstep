#!/usr/bin/env bash
# Publish the built website (web/dist, committed in the repo) to the folder Caddy serves.
# Run as root on the VPS:   bash /home/doorstep/doorstep/scripts/deploy-site.sh
# Old hashed bundles are kept, so pages a visitor already has open keep working.
set -euo pipefail
REPO="${REPO:-/home/doorstep/doorstep}"
DEST="${DEST:-/var/www/arcdoorstep}"
runuser -u doorstep -- git -C "$REPO" pull --ff-only
mkdir -p "$DEST"
cp -r "$REPO/web/dist/." "$DEST/"
chmod -R a+rX "$DEST"
echo "Site published to $DEST from $(runuser -u doorstep -- git -C "$REPO" log -1 --format='%h %s')"
