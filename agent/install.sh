#!/bin/sh
# Installs or upgrades hlm-agent on Debian. Idempotent and non-interactive, so it can be
# run as-is by Ansible. Configuration comes from the environment:
#   HUB_URL, TOKEN, KEY   required on first install (kept from /etc/hlm-agent/agent.env otherwise)
#   ALLOW_INSECURE=true   accept a plain http:// hub
#   AUTO_UPDATE=false     disable the daily self-update
#   SMART=false           skip SMART collection (smartmontools + hourly root timer)
#   REMOTE_UPDATES=false  forbid the "check / install updates" buttons of the dashboard
#   DOCKER=false|true     Docker monitoring (default: enabled when docker is installed)
#   NODE_APPS=false|true  Node.js apps of the base-node playbook (default: enabled when
#                         /usr/local/bin/node-app exists); NODE_APPS_ACTIONS=0 keeps them read-only
#   LXC=all               on a Proxmox host, also install in every running Debian LXC container,
#                         with the shared enrollment token LXC_TOKEN (enr_…, defaults to TOKEN),
#                         then every 2 minutes in each new one (hlm-agent-lxc.timer, tag a CT
#                         no-hlm to leave it out); the hub drops the hosts of deleted containers.
#                         LXC=none stops that; without LXC, a re-run keeps the current choice
#   VERSION=v0.1.12       pin a release (default: latest)
#   REPO=owner/name       GitHub repository hosting the releases
#   INSTALL_METHOD=deb    set by the hlm-agent .deb: no self-update, updates go through the package
# Uninstall: curl -fsSL https://raw.githubusercontent.com/midnights-ra1n/homelab-management/stable/agent/uninstall.sh | sudo sh
set -eu

REPO="${REPO:-midnights-ra1n/homelab-management}"
PREFIX=/opt/hlm-agent
CONF_DIR=/etc/hlm-agent
CONF="$CONF_DIR/agent.env"
SYSTEMD=/etc/systemd/system
LIBEXEC=/usr/local/lib/hlm-agent
STATE=/var/lib/hlm-agent
FILES="install.sh hlm-agent.service hlm-agent-smart.service hlm-agent-smart.timer hlm-agent-smart.path smart-collect.sh
       hlm-agent-apt.path hlm-agent-apt.service apt-action.sh
       hlm-agent-docker.service hlm-agent-docker.timer hlm-agent-docker-update.path
       hlm-agent-docker-update.service docker-helper.sh
       hlm-agent-node-read.path hlm-agent-node-read.service hlm-agent-node-action.path
       hlm-agent-node-action.service node-app-helper.sh
       hlm-agent-lxc.service hlm-agent-lxc.timer lxc-sync.sh"

die() { echo "hlm-agent install: $*" >&2; exit 1; }
say() { echo "hlm-agent install: $*"; }
[ "$(id -u)" -eq 0 ] || die "must run as root"
command -v systemctl >/dev/null || die "systemd is required"

if [ "${1:-}" = "--uninstall" ]; then
  # Kept for compatibility; uninstall.sh is the documented way.
  { curl -fsSL --proto '=https' "https://raw.githubusercontent.com/$REPO/stable/agent/uninstall.sh" 2>/dev/null \
    || wget -qO- --https-only "https://raw.githubusercontent.com/$REPO/stable/agent/uninstall.sh"; } | sh
  exit 0
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH=x86_64 ;;
  aarch64|arm64) ARCH=aarch64 ;;
  *) die "unsupported architecture $(uname -m)" ;;
esac

if [ -n "${BUNDLE:-}" ]; then
  # Files already downloaded and verified by a Proxmox host (LXC=all): no network needed.
  TMP=$BUNDLE
  say "using the files pushed by the Proxmox host ($TMP)"
  [ -f "$TMP/hlm-agent" ] && [ -f "$TMP/sum" ] || die "incomplete bundle $BUNDLE"
else
  if [ -n "${VERSION:-}" ]; then BASE="https://github.com/$REPO/releases/download/$VERSION"
  else BASE="https://github.com/$REPO/releases/latest/download"; fi
  TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
  # $3 = bar: progress bar on a terminal (not under Ansible or in a log file).
  fetch() {
    bar=; [ "${3:-}" = bar ] && [ -t 2 ] && bar=1
    if command -v curl >/dev/null; then
      if [ -n "$bar" ]; then curl -fL -# --proto '=https' --tlsv1.2 -o "$2" "$1"
      else curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1"; fi
    elif command -v wget >/dev/null; then
      if [ -n "$bar" ]; then wget -q --show-progress --https-only -O "$2" "$1"
      else wget -q --https-only -O "$2" "$1"; fi
    else die "curl or wget is required"; fi
  }
  say "downloading hlm-agent ($ARCH) from $BASE"
  fetch "$BASE/hlm-agent-linux-$ARCH" "$TMP/hlm-agent" bar
  fetch "$BASE/hlm-agent-linux-$ARCH.sha256" "$TMP/sum"
  RAW="https://raw.githubusercontent.com/$REPO/${VERSION:-stable}/agent"
  n=$(echo $FILES | wc -w); i=0
  for f in $FILES; do
    i=$((i + 1))
    [ -t 2 ] && printf '\rhlm-agent install: downloading the install files [%-20s] %d/%d' \
      "$(printf '%*s' $((i * 20 / n)) '' | tr ' ' '#')" "$i" "$n" >&2
    fetch "$RAW/$f" "$TMP/$f"
  done
  [ -t 2 ] && echo >&2
  say "downloaded $n install files"
fi
( cd "$TMP" && echo "$(cut -d' ' -f1 sum)  hlm-agent" | sha256sum -c - >/dev/null ) || die "checksum mismatch"
say "checksum OK"

id hlm-agent >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin hlm-agent
install -d -o hlm-agent -g hlm-agent -m 0755 "$PREFIX"
install -o hlm-agent -g hlm-agent -m 0755 "$TMP/hlm-agent" "$PREFIX/hlm-agent"

install -d -m 0750 -g hlm-agent "$CONF_DIR"
if [ -n "${TOKEN:-}" ] || [ ! -f "$CONF" ]; then
  [ -n "${HUB_URL:-}" ] && [ -n "${TOKEN:-}" ] && [ -n "${KEY:-}" ] || die "HUB_URL, TOKEN and KEY are required"
  umask 027
  {
    echo "HUB_URL=$HUB_URL"
    echo "TOKEN=$TOKEN"
    echo "KEY=$KEY"
    [ -n "${ALLOW_INSECURE:-}" ] && echo "ALLOW_INSECURE=$ALLOW_INSECURE"
    [ -n "${AUTO_UPDATE:-}" ] && echo "AUTO_UPDATE=$AUTO_UPDATE"
    [ "$REPO" != "midnights-ra1n/homelab-management" ] && echo "UPDATE_REPO=$REPO"
    [ -n "${PVE_CTID:-}" ] && echo "PVE_CTID=$PVE_CTID" && echo "PVE_NODE=$PVE_NODE"
    true
  } > "$CONF.tmp"
  chown root:hlm-agent "$CONF.tmp"; chmod 0640 "$CONF.tmp"; mv "$CONF.tmp" "$CONF"
  say "configuration written to $CONF (hub $HUB_URL)"
else
  say "keeping the configuration of $CONF"
fi

install -m 0644 "$TMP/hlm-agent.service" "$SYSTEMD/hlm-agent.service"
install -d -o root -g hlm-agent -m 0750 "$STATE"
install -d -o root -g root -m 0755 "$LIBEXEC"

# Optional root helpers. Each is a root-owned script with a fixed job, never the agent binary
# (which the agent can rewrite to update itself). $1 = enabled, $2 = units to enable, rest = files.
helper() {
  enabled=$1; units=$2; shift 2
  if [ "$enabled" = true ]; then
    for f in "$@"; do
      case "$f" in
        *.sh) install -o root -g root -m 0755 "$TMP/$f" "$LIBEXEC/$f" ;;
        *) install -m 0644 "$TMP/$f" "$SYSTEMD/$f" ;;
      esac
    done
    systemctl daemon-reload
    for u in $units; do systemctl enable --now "$u" >/dev/null 2>&1 || true; done
  else
    for u in $units; do systemctl disable --now "$u" >/dev/null 2>&1 || true; done
    for f in "$@"; do case "$f" in *.sh) rm -f "$LIBEXEC/$f" ;; *) rm -f "$SYSTEMD/$f" ;; esac; done
  fi
}

smart=true; [ "${SMART:-true}" = false ] && smart=false
if [ "$smart" = true ] && ! command -v smartctl >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq smartmontools >/dev/null || echo "hlm-agent install: smartmontools not installed, SMART disabled" >&2
fi
helper "$smart" "hlm-agent-smart.timer hlm-agent-smart.path" smart-collect.sh hlm-agent-smart.service hlm-agent-smart.timer hlm-agent-smart.path
[ "$smart" = true ] && { systemctl start hlm-agent-smart.service || true; }

remote=true; [ "${REMOTE_UPDATES:-true}" = false ] && remote=false
helper "$remote" hlm-agent-apt.path apt-action.sh hlm-agent-apt.path hlm-agent-apt.service

docker=${DOCKER:-auto}
if [ "$docker" = auto ]; then if command -v docker >/dev/null 2>&1; then docker=true; else docker=false; fi; fi
dockerunits=hlm-agent-docker.timer; [ "$remote" = true ] && dockerunits="$dockerunits hlm-agent-docker-update.path"
helper "$docker" "$dockerunits" docker-helper.sh hlm-agent-docker.service hlm-agent-docker.timer \
  hlm-agent-docker-update.path hlm-agent-docker-update.service
[ "$docker" = true ] && [ "$remote" = false ] && systemctl disable --now hlm-agent-docker-update.path >/dev/null 2>&1
[ "$docker" = true ] && { systemctl start hlm-agent-docker.service || true; }

node=${NODE_APPS:-auto}
if [ "$node" = auto ]; then if [ -x /usr/local/bin/node-app ]; then node=true; else node=false; fi; fi
nodeact=false; [ "$node" = true ] && [ "${NODE_APPS_ACTIONS:-1}" != 0 ] && nodeact=true
helper "$node" hlm-agent-node-read.path node-app-helper.sh hlm-agent-node-read.path hlm-agent-node-read.service
helper "$nodeact" hlm-agent-node-action.path hlm-agent-node-action.path hlm-agent-node-action.service
say "options: SMART=$smart, remote updates=$remote, Docker=$docker, Node.js apps=$node (actions=$nodeact)"

# Installed by the .deb: the package owns the binary, so the agent must not rewrite it.
if [ "${INSTALL_METHOD:-}" = deb ]; then
  install -d -m 0755 "$SYSTEMD/hlm-agent.service.d"
  printf '[Service]\nEnvironment=INSTALL_METHOD=deb\n' > "$SYSTEMD/hlm-agent.service.d/deb.conf"
else
  rm -f "$SYSTEMD/hlm-agent.service.d/deb.conf"
fi
systemctl daemon-reload
systemctl enable hlm-agent >/dev/null 2>&1
say "starting hlm-agent.service"
systemctl restart hlm-agent || true
sleep 2
# Unprivileged LXC containers without nesting cannot set up the service sandbox
# (mount namespaces): fall back to running without those protections there only.
if ! systemctl is-active -q hlm-agent && systemd-detect-virt -cq 2>/dev/null; then
  say "the service did not start in this container, retrying without its sandbox"
  install -d -m 0755 "$SYSTEMD/hlm-agent.service.d"
  cat > "$SYSTEMD/hlm-agent.service.d/container.conf" <<'EOF'
# Written by install.sh: this container cannot create the sandbox of hlm-agent.service.
[Service]
ProtectSystem=no
ProtectHome=no
PrivateTmp=no
PrivateDevices=no
ProtectKernelTunables=no
ProtectKernelModules=no
ProtectKernelLogs=no
ProtectControlGroups=no
ProtectClock=no
ProtectHostname=no
RestrictNamespaces=no
EOF
  systemctl daemon-reload
  systemctl restart hlm-agent || true
  sleep 2
fi
systemctl is-active -q hlm-agent || die "hlm-agent did not start, see: journalctl -u hlm-agent -n 30"
echo "hlm-agent $("$PREFIX/hlm-agent" --version) installed and running on $(hostname)"

# Proxmox: install the same files in every running Debian LXC container, now and in the new ones.
if [ "${LXC:-}" = all ]; then
  command -v pct >/dev/null 2>&1 || die "LXC=all only works on a Proxmox host"
  ctoken=${LXC_TOKEN:-${TOKEN:-}}
  case "$ctoken" in enr_*) ;; *) die "LXC=all needs a shared enrollment token: LXC_TOKEN=enr_… (Hôtes → Déploiement en masse)" ;; esac
  conf() { sed -n "s/^$1=//p" "$CONF" | head -n1; }
  umask 077
  {
    echo "HUB_URL=${HUB_URL:-$(conf HUB_URL)}"
    echo "LXC_TOKEN=$ctoken"
    echo "KEY=${KEY:-$(conf KEY)}"
    echo "ALLOW_INSECURE=${ALLOW_INSECURE:-$(conf ALLOW_INSECURE)}"
    echo "AUTO_UPDATE=${AUTO_UPDATE:-}"
    echo "REMOTE_UPDATES=$remote"
    echo "REPO=$REPO"
  } > "$CONF_DIR/lxc.env"
  umask 022
  rm -rf "$LIBEXEC/bundle"; install -d -m 0700 "$LIBEXEC/bundle"
  for f in hlm-agent sum $FILES; do install -m 0600 "$TMP/$f" "$LIBEXEC/bundle/$f"; done
  # The timer is enabled after the first pass, which would otherwise wait for its lock.
  helper true "" lxc-sync.sh hlm-agent-lxc.service hlm-agent-lxc.timer
  say "installing in the running LXC containers (hub $(sed -n 's/^HUB_URL=//p' "$CONF_DIR/lxc.env"))"
  "$LIBEXEC/lxc-sync.sh" all
  systemctl enable --now hlm-agent-lxc.timer >/dev/null 2>&1 || true
  say "new LXC containers will get the agent within 2 minutes (hlm-agent-lxc.timer)"
elif [ "${LXC:-}" = none ]; then
  helper false hlm-agent-lxc.timer lxc-sync.sh hlm-agent-lxc.service hlm-agent-lxc.timer
  rm -rf "$CONF_DIR/lxc.env" "$LIBEXEC/bundle" "$STATE/lxc"
fi
