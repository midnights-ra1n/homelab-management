#!/bin/sh
# Proxmox host (install.sh LXC=all): keeps hlm-agent in the LXC containers. Run as root every
# two minutes by hlm-agent-lxc.timer, and by install.sh with "all".
# - Lists every CT ID of the cluster for the agent, so the hub drops the hosts of deleted CTs.
# - Installs the agent in each running Debian container that does not have it yet (with "all":
#   in every running Debian container), from the files install.sh kept in $LIB/bundle.
# - No shared token: a container without the agent gets its own host token from the hub. This
#   script writes want/<CT ID> (its hostname), the agent asks the hub and drops the answer in
#   its state directory (lxc-token-<CT ID>), the next pass installs with it. A container that
#   already has the agent keeps its configuration (install.sh without TOKEN).
# A container tagged no-hlm in Proxmox is left alone. A failed install is retried after an hour.
# Root-owned on purpose: it must never be something the unprivileged agent can rewrite.
set -eu
LIB=/usr/local/lib/hlm-agent
BUNDLE=$LIB/bundle
OUT=/var/lib/hlm-agent/lxc
ENV=/etc/hlm-agent/lxc.env
TOKENS=/var/lib/hlm-agent/state
mode=${1:-new}
[ -f "$ENV" ] && [ -f "$BUNDLE/hlm-agent" ] || { echo "hlm-agent-lxc: $ENV or $BUNDLE missing, run install.sh with LXC=all" >&2; exit 1; }
. "$ENV"
install -d -o root -g hlm-agent -m 0750 "$OUT"
install -d -m 0700 "$OUT/tried"
install -d -o root -g hlm-agent -m 0750 "$OUT/want"
# One run at a time: install.sh may start one while the timer runs another.
exec 9>"$OUT/.lock"
flock 9

# Every CT of the cluster, not only this node's: a migrated container must not look deleted.
# Only while pmxcfs is mounted, else the list would be empty and every container look deleted.
if [ -f /etc/pve/.version ]; then
  for f in /etc/pve/nodes/*/lxc/*.conf; do [ -e "$f" ] && basename "$f" .conf; done > "$OUT/cts.new"
  # Rewritten only when it changed: this runs every two minutes.
  if cmp -s "$OUT/cts.new" "$OUT/cts"; then rm -f "$OUT/cts.new"
  else chgrp hlm-agent "$OUT/cts.new"; chmod 0640 "$OUT/cts.new"; mv "$OUT/cts.new" "$OUT/cts"; fi
fi

# Every pct call starts Perl and loads the Proxmox modules: the read-only checks below read
# the config (pmxcfs, in memory) and the container's file system through /proc instead.
ok=0; failed=0
for conf in /etc/pve/lxc/*.conf; do
  [ -e "$conf" ] || continue
  ct=$(basename "$conf" .conf)
  pid=$(lxc-info -n "$ct" -p -H 2>/dev/null) || continue
  [ -n "$pid" ] || continue # stopped
  main=$(sed '/^\[/q' "$conf") # without the snapshot sections
  name=$(echo "$main" | sed -n 's/^hostname: //p')
  if echo "$main" | grep -Eq '^tags:.*(^|[ ;,])no-hlm([ ;,]|$)'; then
    [ "$mode" = all ] && echo "  CT $ct ($name): tagged no-hlm, skipped"
    continue
  fi
  if [ "$mode" != all ]; then
    [ -x "/proc/$pid/root/opt/hlm-agent/hlm-agent" ] && { rm -f "$OUT/want/$ct"; continue; }
    [ -n "$(find "$OUT/tried/$ct" -mmin -60 2>/dev/null)" ] && continue
  fi
  tok=
  if [ ! -f "/proc/$pid/root/etc/hlm-agent/agent.env" ]; then
    # Written by the unprivileged agent: one token of the expected form, never through a link.
    t=$TOKENS/lxc-token-$ct
    [ -f "$t" ] && [ ! -L "$t" ] && tok=$(head -c 44 "$t" | grep -Ex '[A-Za-z0-9_-]{43}' || true)
    rm -f "$t"
    if [ -z "$tok" ]; then
      if [ ! -f "$OUT/want/$ct" ]; then
        printf '%s\n' "$name" > "$OUT/want/$ct"; chgrp hlm-agent "$OUT/want/$ct"; chmod 0640 "$OUT/want/$ct"
      fi
      echo "  CT $ct ($name): token asked to the hub, installed at a next pass (2 to 4 minutes)"
      continue
    fi
    rm -f "$OUT/want/$ct"
  fi
  [ "$mode" != all ] && echo "  CT $ct ($name): new container without the agent"
  touch "$OUT/tried/$ct"
  if ! pct exec "$ct" -- sh -c 'test -f /etc/debian_version && command -v systemctl' >/dev/null 2>&1; then
    echo "  CT $ct ($name): not Debian with systemd, skipped"; continue
  fi
  echo "  CT $ct ($name): pushing the files"
  pct exec "$ct" -- sh -c 'rm -rf /tmp/hlm-bundle && mkdir -m 0700 /tmp/hlm-bundle'
  all=$(ls "$BUNDLE"); n=$(echo $all | wc -w); i=0
  for f in $all; do
    i=$((i + 1))
    [ -t 1 ] && printf '\r      [%-20s] %d/%d' "$(printf '%*s' $((i * 20 / n)) '' | tr ' ' '#')" "$i" "$n"
    pct push "$ct" "$BUNDLE/$f" "/tmp/hlm-bundle/$f"
  done
  [ -t 1 ] && echo
  # pct exec keeps the host environment: blank what must not reach the container,
  # LXC above all (the container has no pct and would fail on LXC=all).
  { pct exec "$ct" -- env LXC= LXC_TOKEN= DOCKER= NODE_APPS= INSTALL_METHOD= HOST_TYPE=lxc PVE_CTID="$ct" PVE_NODE="$(hostname)" \
      HUB_URL="$HUB_URL" TOKEN="$tok" KEY="$KEY" ALLOW_INSECURE="${ALLOW_INSECURE:-}" \
      AUTO_UPDATE="${AUTO_UPDATE:-}" SMART=false REMOTE_UPDATES="${REMOTE_UPDATES:-true}" REPO="$REPO" BUNDLE=/tmp/hlm-bundle \
      sh /tmp/hlm-bundle/install.sh 2>&1 && rc=0 || rc=$?; echo "$rc" > "$OUT/rc"; } | sed 's/^/      /'
  if [ "$(cat "$OUT/rc")" = 0 ]; then
    echo "  CT $ct ($name): installed"; ok=$((ok + 1)); rm -f "$OUT/tried/$ct"
  else
    echo "  CT $ct ($name): FAILED, last lines of journalctl -u hlm-agent:"; failed=$((failed + 1))
    pct exec "$ct" -- journalctl -u hlm-agent -n 15 --no-pager 2>&1 | sed 's/^/      /' || true
  fi
  pct exec "$ct" -- rm -rf /tmp/hlm-bundle || true
done
[ "$mode" = all ] || [ $((ok + failed)) -gt 0 ] && echo "LXC containers: $ok installed, $failed failed"
# Forget the containers that no longer exist.
for f in "$OUT"/tried/* "$OUT"/want/* "$TOKENS"/lxc-token-*; do [ -e "$f" ] && ! pct status "${f##*[/-]}" >/dev/null 2>&1 && rm -f "$f"; done
exit 0
