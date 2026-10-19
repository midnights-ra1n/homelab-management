#!/bin/sh
# apt actions requested from the Midnights Monitoring dashboard, run as root by
# hlm-agent-apt.path when the agent drops a request file. Root-owned on purpose, and it
# accepts exactly three words from the unprivileged agent: "refresh" (apt-get update),
# "upgrade" (apt-get update + upgrade) and "agentdeb" (install the latest hlm-agent .deb of
# the GitHub release, after checking its SHA-256). Disable with REMOTE_UPDATES=false.
set -u
REQ=/var/lib/hlm-agent/state/apt-request
OUT=/var/lib/hlm-agent/apt
[ -f "$REQ" ] && [ ! -L "$REQ" ] || { rm -f "$REQ"; exit 0; }
action=$(head -c 16 "$REQ" | tr -dc 'a-z')
rm -f "$REQ"
case "$action" in refresh|upgrade|agentdeb) ;; *) exit 0 ;; esac

install -d -o root -g hlm-agent -m 0750 "$OUT"
status() {
  printf '{"action":"%s","state":"%s","exit_code":%s,"finished_at":%s}\n' "$action" "$1" "$2" "$(date +%s)" > "$OUT/status.tmp"
  chgrp hlm-agent "$OUT/status.tmp"; chmod 0640 "$OUT/status.tmp"; mv "$OUT/status.tmp" "$OUT/status.json"
}
status running null
: > "$OUT/log"; chgrp hlm-agent "$OUT/log"; chmod 0640 "$OUT/log"

export DEBIAN_FRONTEND=noninteractive LC_ALL=C
if [ "$action" = agentdeb ]; then
  # The repository comes from the root-owned configuration, never from the agent.
  repo=$(sed -n 's/^UPDATE_REPO=//p' /etc/hlm-agent/agent.env 2>/dev/null | head -n1 | tr -dc 'A-Za-z0-9._/-')
  repo=${repo:-midnights-ra1n/homelab-management}
  tmp=$(mktemp -d)
  rc=1
  tag=$(curl -fsSL --proto '=https' "https://api.github.com/repos/$repo/releases/latest" 2>>"$OUT/log" \
    | sed -n 's/.*"tag_name": *"\(v[0-9][0-9.]*\)".*/\1/p' | head -n1)
  f="hlm-agent_${tag#v}_$(dpkg --print-architecture).deb"
  if [ -n "$tag" ] && curl -fsSL --proto '=https' -o "$tmp/$f" "https://github.com/$repo/releases/download/$tag/$f" >>"$OUT/log" 2>&1 \
    && curl -fsSL --proto '=https' -o "$tmp/sum" "https://github.com/$repo/releases/download/$tag/$f.sha256" >>"$OUT/log" 2>&1 \
    && (cd "$tmp" && echo "$(cut -d' ' -f1 sum)  $f" | sha256sum -c -) >>"$OUT/log" 2>&1; then
    echo "installation de $f" >> "$OUT/log"
    status done 0 # reported now: installing the package restarts the agent
    apt-get install -y -q "$tmp/$f" >> "$OUT/log" 2>&1 && rc=0
  else
    echo "téléchargement ou vérification de $f impossible" >> "$OUT/log"
  fi
  rm -rf "$tmp"
  [ "$rc" -eq 0 ] || status failed "$rc"
  exit 0
fi
apt-get update -q >> "$OUT/log" 2>&1
rc=$?
if [ "$rc" -eq 0 ] && [ "$action" = upgrade ]; then
  # Keep local configuration files; never remove packages (no dist-upgrade).
  apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --with-new-pkgs upgrade >> "$OUT/log" 2>&1
  rc=$?
fi
if [ "$rc" -eq 0 ]; then status done 0; else status failed "$rc"; fi
