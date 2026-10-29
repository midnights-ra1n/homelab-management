#!/bin/sh
# Removes hlm-agent completely: services, timers, binary, configuration, state and user.
#   curl -fsSL https://raw.githubusercontent.com/midnights-ra1n/homelab-management/stable/agent/uninstall.sh | sudo sh
# On a Proxmox host it is also removed from every running LXC container that has it;
# LXC=none keeps the containers' agents.
# smartmontools is left installed (other tools may use it). The hosts stay listed in the
# dashboard until you delete them there.
set -eu
[ "$(id -u)" -eq 0 ] || { echo "hlm-agent uninstall: must run as root" >&2; exit 1; }

# Kept in a variable so the same steps can be piped into each LXC container.
REMOVE=$(cat <<'EOS'
units="hlm-agent.service hlm-agent-smart.timer hlm-agent-smart.path hlm-agent-smart.service hlm-agent-apt.path hlm-agent-apt.service
       hlm-agent-docker.timer hlm-agent-docker.service hlm-agent-docker-update.path hlm-agent-docker-update.service
       hlm-agent-node-read.path hlm-agent-node-read.service hlm-agent-node-action.path hlm-agent-node-action.service"
if command -v systemctl >/dev/null 2>&1; then
  for u in $units; do systemctl disable --now "$u" 2>/dev/null || true; done
fi
for u in $units; do rm -f "/etc/systemd/system/$u"; done
rm -rf /etc/systemd/system/hlm-agent.service.d /opt/hlm-agent /etc/hlm-agent /usr/local/lib/hlm-agent /var/lib/hlm-agent
command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload
if id hlm-agent >/dev/null 2>&1; then userdel hlm-agent; fi
echo "hlm-agent removed from $(hostname)"
EOS
)

sh -c "$REMOVE"

if [ "${LXC:-}" != none ] && command -v pct >/dev/null 2>&1; then
  echo "Proxmox host: removing hlm-agent from the running LXC containers (LXC=none to skip)"
  removed=0; failed=0
  for ct in $(pct list | awk 'NR > 1 && $2 == "running" { print $1 }'); do
    name=$(pct config "$ct" | sed -n 's/^hostname: //p')
    pct exec "$ct" -- test -d /opt/hlm-agent 2>/dev/null || continue
    if printf '%s\n' "$REMOVE" | pct exec "$ct" -- sh -s >/dev/null 2>&1; then
      echo "  CT $ct ($name): removed"; removed=$((removed + 1))
    else
      echo "  CT $ct ($name): removal FAILED (pct enter $ct)"; failed=$((failed + 1))
    fi
  done
  echo "LXC containers: $removed removed, $failed failed (stopped containers are not checked)"
fi
