#!/bin/sh
# Installs the release requested from the settings page (Mises à jour du serveur). Run as root
# by homelab-tools-update.path. The unprivileged server can only write a version tag in the
# request file; the download URL and the repository are fixed here, and the .deb must match
# the SHA-256 file published with it.
set -u
REQ=/var/lib/homelab-tools/update/request
REPO=midnights-ra1n/homelab-management
[ -f "$REQ" ] && [ ! -L "$REQ" ] || { rm -f "$REQ"; exit 0; }
tag=$(head -c 32 "$REQ" | tr -dc 'v0-9.')
case "$tag" in v[0-9]*.[0-9]*.[0-9]*) ;; *) echo "invalid request: $tag"; rm -f "$REQ"; exit 1 ;; esac

arch=$(dpkg --print-architecture)
file="homelab-tools_${tag#v}_${arch}.deb"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"; rm -f "$REQ"' EXIT
base="https://github.com/$REPO/releases/download/$tag"
if ! curl -fsSL --proto '=https' -o "$tmp/$file" "$base/$file" || ! curl -fsSL --proto '=https' -o "$tmp/sum" "$base/$file.sha256"; then
  echo "download of $file failed"; exit 1
fi
(cd "$tmp" && echo "$(cut -d' ' -f1 sum)  $file" | sha256sum -c -) || { echo "checksum mismatch, update refused"; exit 1; }
echo "installing $file"
DEBIAN_FRONTEND=noninteractive apt-get install -y -q -o Dpkg::Options::=--force-confold "$tmp/$file"
