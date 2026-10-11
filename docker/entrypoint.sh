#!/bin/sh
# Lancé par tini (PID 1). Compatible Docker, Podman et CT Proxmox depuis une image OCI.
set -e

# LXC peut définir HOSTNAME au nom du CT : Next.js écouterait alors sur ce nom au lieu de toutes les interfaces.
export HOSTNAME=0.0.0.0

# Proxmox crée les points de montage en root (et peut ignorer USER) : on rend /data à l'utilisateur app (1001).
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA_DIR"
  [ "$(stat -c %u "$DATA_DIR")" = 1001 ] || chown -R 1001:1001 "$DATA_DIR"
  exec su-exec 1001:1001 "$@"
fi
exec "$@"
