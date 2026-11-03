#!/bin/sh
# apt actions requested from the Midnights Monitoring dashboard, run as root by
# hlm-agent-apt.path when the agent drops a request file. Root-owned on purpose, and it
# accepts exactly three words from the unprivileged agent: "refresh" (apt-get update),
# "upgrade" (apt-get update + upgrade) and "agentdeb" (install the latest hlm-agent .deb of
# the GitHub release, after checking its SHA-256). Disable with REMOTE_UPDATES=false.
# On a Proxmox host, "lxc" re-runs install.sh with LXC=all (agent in the LXC containers, now and
# in the new ones); each container gets its own token from the hub (lxc-sync.sh).
# "reinstall" re-runs install.sh with the options of state/reinstall-opts (deployment type of the
# dashboard: HOST_TYPE, SMART, AUTO_UPDATE, LXC), each checked against a closed list; Docker and
# Node.js apps are detected again.
set -u
REQ=/var/lib/hlm-agent/state/apt-request
OUT=/var/lib/hlm-agent/apt
[ -f "$REQ" ] && [ ! -L "$REQ" ] || { rm -f "$REQ"; exit 0; }
action=$(head -c 16 "$REQ" | tr -dc 'a-z')
rm -f "$REQ"
case "$action" in refresh|upgrade|agentdeb|lxc|reinstall) ;; *) exit 0 ;; esac

install -d -o root -g hlm-agent -m 0750 "$OUT"
status() {
  printf '{"action":"%s","state":"%s","exit_code":%s,"finished_at":%s}\n' "$action" "$1" "$2" "$(date +%s)" > "$OUT/status.tmp"
  chgrp hlm-agent "$OUT/status.tmp"; chmod 0640 "$OUT/status.tmp"; mv "$OUT/status.tmp" "$OUT/status.json"
}
status running null
: > "$OUT/log"; chgrp hlm-agent "$OUT/log"; chmod 0640 "$OUT/log"

export DEBIAN_FRONTEND=noninteractive LC_ALL=C
# The repository comes from the root-owned configuration, never from the agent.
repo=$(sed -n 's/^UPDATE_REPO=//p' /etc/hlm-agent/agent.env 2>/dev/null | head -n1 | tr -dc 'A-Za-z0-9._/-')
repo=${repo:-midnights-ra1n/homelab-management}
# Re-runs install.sh as it was installed (.deb: the package's own files, nothing downloaded), with "$@".
run_install() {
  if [ -f /etc/systemd/system/hlm-agent.service.d/deb.conf ]; then
    env "$@" INSTALL_METHOD=deb BUNDLE=/usr/share/hlm-agent sh /usr/share/hlm-agent/install.sh >> "$OUT/log" 2>&1
    return
  fi
  tmp=$(mktemp -d); r=1
  curl -fsSL --proto '=https' -o "$tmp/install.sh" "https://raw.githubusercontent.com/$repo/stable/agent/install.sh" >> "$OUT/log" 2>&1 \
    && env "$@" REPO="$repo" sh "$tmp/install.sh" >> "$OUT/log" 2>&1 && r=0
  rm -rf "$tmp"
  return "$r"
}
if [ "$action" = lxc ] || [ "$action" = reinstall ]; then
  S=/var/lib/hlm-agent/state
  L=/usr/local/lib/hlm-agent
  # Each file must be one line of expected words: no other file can be read through it (symbolic link).
  opts=; [ -f "$S/reinstall-opts" ] && [ ! -L "$S/reinstall-opts" ] && opts=$(head -c 200 "$S/reinstall-opts" | head -n1)
  rm -f "$S/lxc-token" "$S/reinstall-opts" # lxc-token: left by an older agent
  rc=1 lxc=0 bad=
  if [ "$action" = lxc ]; then
    lxc=1
    # Keep the options as installed: a re-run of install.sh without them would reset them.
    set -- SMART=true
    if [ -x "$L/docker-helper.sh" ]; then set -- "$@" DOCKER=true; else set -- "$@" DOCKER=false; fi
    if [ -x "$L/node-app-helper.sh" ]; then set -- "$@" NODE_APPS=true; else set -- "$@" NODE_APPS=false; fi
    au=$(sed -n 's/^AUTO_UPDATE=//p' /etc/hlm-agent/agent.env | head -n1 | tr -dc 'a-z')
    [ -n "$au" ] && set -- "$@" "AUTO_UPDATE=$au"
  else
    set -- ; set -f # words only, never file names
    for w in $opts; do
      case "$w" in
        HOST_TYPE=auto | HOST_TYPE=proxmox | HOST_TYPE=physical | HOST_TYPE=vm | HOST_TYPE=lxc | HOST_TYPE=vps \
        | SMART=true | SMART=false | AUTO_UPDATE=true | AUTO_UPDATE=false | LXC=none) set -- "$@" "$w" ;;
        LXC=all) lxc=1 ;;
        LXC=keep) ;;
        *) bad=$w ;;
      esac
    done
  fi
  # A host made read-only for its Node.js apps stays so; otherwise they are detected again.
  [ -x "$L/node-app-helper.sh" ] && [ ! -f /etc/systemd/system/hlm-agent-node-action.path ] && set -- "$@" NODE_APPS_ACTIONS=0
  if [ -n "$bad" ] || { [ "$action" = reinstall ] && [ -z "$opts" ]; }; then
    echo "options refusées : ${bad:-aucune}" >> "$OUT/log"
  elif [ "$lxc" = 1 ] && ! command -v pct >/dev/null 2>&1; then
    echo "pct introuvable : cette machine n'est pas un serveur Proxmox" >> "$OUT/log"
  else
    [ "$lxc" = 1 ] && set -- "$@" LXC=all
    if [ "$action" = lxc ]; then
      echo "installation de l'agent dans les conteneurs LXC (le service hlm-agent redémarre)" >> "$OUT/log"
    else
      echo "réinstallation de l'agent ($opts), le service hlm-agent redémarre" >> "$OUT/log"
    fi
    run_install "$@" && rc=0
  fi
  if [ "$rc" -eq 0 ]; then status done 0; else status failed "$rc"; fi
  exit 0
fi
if [ "$action" = agentdeb ]; then
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
