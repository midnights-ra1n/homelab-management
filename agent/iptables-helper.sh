#!/bin/bash
# Firewall of any host (iptables, netfilter-persistent) for hlm-agent and node-app-ui. Root-owned.
#   read      one request of the unprivileged agent (hlm-agent-iptables.path), answered in $OUT
#   cli VERB  the same verbs for node-app-ui (already root): payload on stdin, answer on stdout
#   rollback  restores the rules of the filter table, started by the timer armed before a change
# Verbs: fw-list, fw-apply (payload: key=value lines), fw-confirm, fw-save, fw-install.
# The caller is not trusted: each value is checked here and passed as one argument. Raw iptables
# arguments are never accepted (--modprobe runs a command): a rule to delete must exist as such.
set -u
export LC_ALL=C.UTF-8 PATH=$PATH:/usr/sbin:/sbin
OUT=/var/lib/hlm-agent/iptables
STATE=/var/lib/hlm-agent/state
CHOICE=/etc/hlm-agent/iptables # true, or read: read-only host (IPTABLES=read)
RUN=${HLM_IPTABLES_RUN:-/run/hlm-iptables}
RULES=${HLM_IPTABLES_RULES:-/etc/iptables} # netfilter-persistent's files
UNIT=hlm-iptables-rollback
DELAY=60 # seconds for the caller to confirm that the host is still reachable
SELF=$(readlink -f "$0")
MODE=write

fail() { echo "$*"; exit 1; }
can_write() { [ "$MODE" = write ] || fail "Hôte en lecture seule (IPTABLES=read)"; }
pending() { systemctl is-active -q "$UNIT.timer" 2>/dev/null; }

# The filter table without what Docker and fail2ban change on their own, to compare two states.
comparable() {
  sed -n '/^\*filter/,/^COMMIT/p' | grep -Ev '^#|f2b-|DOCKER|docker0|br-[0-9a-f]{12}' | sed 's/ \[[0-9]*:[0-9]*\]$//'
}

# iptables-save as JSON: [{"table":…,"chains":[{"name":…,"policy":…,"rules":["-A …"]}]}].
as_json() {
  sed 's/\\/\\\\/g; s/"/\\"/g' | awk '
    /^\*/ { t = substr($0, 2); nc = 0; next }
    /^:/ { c = substr($1, 2); order[++nc] = c; policy[c] = $2; rules[c] = ""; next }
    /^-A / { c = $2; rules[c] = rules[c] (rules[c] == "" ? "" : ",") "\"" $0 "\""; next }
    /^COMMIT/ {
      printf "%s{\"table\":\"%s\",\"chains\":[", (nt++ ? "," : ""), t
      for (i = 1; i <= nc; i++) {
        c = order[i]
        printf "%s{\"name\":\"%s\",\"policy\":\"%s\",\"rules\":[%s]}", (i > 1 ? "," : ""), c, policy[c], rules[c]
      }
      printf "]}"
    }'
}

fw_list() {
  local avail=false persistent=false writable=false sep= ipt family saved
  command -v iptables-save >/dev/null && avail=true
  command -v netfilter-persistent >/dev/null && persistent=true
  [ "$MODE" = write ] && writable=true
  printf '{"available":%s,"persistent":%s,"writable":%s,"families":[' "$avail" "$persistent" "$writable"
  for family in 4 6; do
    [ "$family" = 4 ] && ipt=iptables || ipt=ip6tables
    command -v "$ipt-save" >/dev/null || continue
    local rules
    rules=$("$ipt-save" 2>/dev/null) || continue
    [ -n "$rules" ] || continue
    saved=false
    [ "$(comparable <<< "$rules")" = "$(cat "$RULES/rules.v$family" 2>/dev/null | comparable)" ] && saved=true
    printf '%s{"family":"%s","saved":%s,"tables":[' "$sep" "$family" "$saved"
    as_json <<< "$rules"
    printf ']}'
    sep=,
  done
  printf ']}\n'
}

# Arguments of the new rule from the checked fields, into the global array args.
add_args() {
  local any='^[A-Za-z][A-Za-z0-9_-]{0,27}$' port='^[0-9]{1,5}(:[0-9]{1,5})?$' addr='^[0-9A-Fa-f:.]+(/[0-9]{1,3})?$'
  local dev='^[A-Za-z0-9][A-Za-z0-9_.+-]{0,14}$' note='^[[:alnum:] _.,:/()-]{1,100}$'
  [[ $chain =~ $any ]] || fail "Chaîne invalide"
  "$IPT" -w 5 -t filter -S "$chain" >/dev/null 2>&1 || fail "Chaîne inconnue : $chain"
  case $position in
    top) args=(-I "$chain" 1) ;;
    bottom) args=(-A "$chain") ;;
    *) fail "Position invalide" ;;
  esac
  case $proto in
    "" | all) proto= ;;
    tcp | udp) args+=(-p "$proto") ;;
    icmp) if [ "$family" = 6 ]; then args+=(-p ipv6-icmp); else args+=(-p icmp); fi ;;
    *) fail "Protocole invalide" ;;
  esac
  if [ -n "$dport" ]; then
    [ "$proto" = tcp ] || [ "$proto" = udp ] || fail "Un port demande le protocole TCP ou UDP"
    [[ $dport =~ $port ]] && ((10#${dport%:*} <= 65535 && 10#${dport#*:} <= 65535)) || fail "Port invalide (443, ou 8000:8100)"
    args+=(--dport "$dport")
  fi
  if [ -n "$source" ]; then
    [[ $source =~ $addr ]] || fail "Source invalide (adresse ou réseau CIDR)"
    args+=(-s "$source")
  fi
  if [ -n "$iface" ]; then
    [[ $iface =~ $dev ]] || fail "Interface invalide"
    args+=(-i "$iface")
  fi
  if [ -n "$comment" ]; then
    [[ $comment =~ $note ]] || fail "Commentaire invalide (lettres, chiffres et . , : / ( ) - _)"
    args+=(-m comment --comment "$comment")
  fi
  case $target in
    ACCEPT | DROP | REJECT) args+=(-j "$target") ;;
    *) fail "Action invalide" ;;
  esac
}

arm_rollback() {
  mkdir -p -m 0700 "$RUN" || fail "Sauvegarde des règles impossible"
  "$IPT-save" -t filter > "$RUN/rollback.$IPT" || fail "Lecture des règles impossible"
  if ! systemd-run --quiet --collect --on-active="$DELAY" --unit="$UNIT" "$SELF" rollback >/dev/null 2>&1; then
    rm -f "$RUN/rollback.$IPT"
    fail "Retour arrière automatique impossible : règles inchangées"
  fi
}

fw_confirm() {
  systemctl stop "$UNIT.timer" 2>/dev/null
  rm -f "$RUN"/rollback.*
}

rollback() {
  local f
  for f in "$RUN"/rollback.*; do
    [ -f "$f" ] && "${f##*.}-restore" < "$f"
    rm -f "$f"
  done
}

# One change of the filter table, undone after $DELAY seconds unless fw-confirm arrives first: a
# rule that cuts the agent or the browser off cannot leave the host out of reach.
fw_apply() {
  can_write
  local op= family= chain= position= proto= dport= source= iface= target= comment= rule= policy= line key
  while IFS= read -r line; do
    key=${line%%=*}
    case $key in
      op | family | chain | position | proto | dport | source | iface | target | comment | rule | policy) printf -v "$key" '%s' "${line#*=}" ;;
    esac
  done
  case $family in 4) IPT=iptables ;; 6) IPT=ip6tables ;; *) fail "Famille invalide" ;; esac
  command -v "$IPT" >/dev/null || fail "$IPT n'est pas installé"
  pending && fail "Une modification attend encore sa confirmation : réessayez dans une minute"
  local err rc
  case $op in
    add)
      args=()
      add_args
      arm_rollback
      err=$("$IPT" -w 5 -t filter "${args[@]}" 2>&1); rc=$? ;;
    delete)
      [[ $rule == "-A "* ]] && "$IPT-save" -t filter | grep -Fxq -- "$rule" || fail "Règle introuvable : la liste a changé"
      arm_rollback
      err=$(printf '*filter\n-D %s\nCOMMIT\n' "${rule#-A }" | "$IPT-restore" -w 5 --noflush 2>&1); rc=$? ;;
    policy)
      case $chain in INPUT | FORWARD | OUTPUT) ;; *) fail "Chaîne sans politique par défaut" ;; esac
      case $policy in ACCEPT | DROP) ;; *) fail "Politique invalide" ;; esac
      arm_rollback
      err=$("$IPT" -w 5 -t filter -P "$chain" "$policy" 2>&1); rc=$? ;;
    *) fail "Opération inconnue" ;;
  esac
  if [ "$rc" -ne 0 ]; then
    fw_confirm
    fail "$err"
  fi
}

fw_save() {
  can_write
  pending && fail "Une modification attend encore sa confirmation : réessayez dans une minute"
  command -v netfilter-persistent >/dev/null || fail "netfilter-persistent n'est pas installé"
  netfilter-persistent save 2>&1 || exit 1
  # fail2ban rebuilds its chains when it starts: saved ones would keep past bans for ever.
  local f
  for f in "$RULES"/rules.v[46]; do
    [ -f "$f" ] && grep -Ev '^:f2b-|^-A f2b-|-j f2b-' "$f" > "$f.tmp" && cat "$f.tmp" > "$f"
    rm -f "$f.tmp"
  done
  echo "Règles enregistrées : elles seront rechargées au redémarrage."
}

fw_install() {
  can_write
  command -v apt-get >/dev/null || fail "Installation automatique réservée à Debian et Ubuntu"
  # The package conflicts with ufw: apt would remove it, and with it the rules of this host.
  dpkg -s ufw >/dev/null 2>&1 && fail "ufw est installé et serait supprimé par iptables-persistent : retirez-le d'abord"
  debconf-set-selections <<'SEL'
iptables-persistent iptables-persistent/autosave_v4 boolean false
iptables-persistent iptables-persistent/autosave_v6 boolean false
SEL
  DEBIAN_FRONTEND=noninteractive timeout 4m apt-get install -y -qq -o DPkg::Lock::Timeout=60 iptables iptables-persistent 2>&1 | tail -n 20
  [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
}

dispatch() {
  case "$1" in
    fw-list) fw_list ;;
    fw-apply) fw_apply ;;
    fw-confirm) fw_confirm ;;
    fw-save) fw_save ;;
    fw-install) fw_install ;;
    *) fail "Requête refusée" ;;
  esac
}

# One line from the request file the agent dropped, restricted to safe characters.
take() {
  local req=$STATE/iptables-read
  [ -f "$req" ] && [ ! -L "$req" ] || { rm -f "$req"; return; }
  head -c 100 "$req" | head -n1 | tr -dc 'A-Za-z0-9 _-'
  rm -f "$req"
}

# Answer of a read: read.out (text), then read.done = "<seq> <code> <offset>" (same as node-app-helper.sh).
read_req() {
  local line seq verb pl=$STATE/iptables-payload code
  [ "$(cat "$CHOICE" 2>/dev/null)" = true ] || MODE=read
  line=$(take)
  read -r seq verb _ <<< "$line"
  if [[ ${seq:-} =~ ^[0-9]{1,18}$ ]]; then
    install -d -o root -g hlm-agent -m 0750 "$OUT"
    : > "$OUT/read.out"; chgrp hlm-agent "$OUT/read.out"; chmod 0640 "$OUT/read.out"
    if [ -f "$pl" ] && [ ! -L "$pl" ]; then
      (dispatch "${verb:-}") < <(head -c 8192 "$pl") > "$OUT/read.out" 2>&1
    else
      (dispatch "${verb:-}") < /dev/null > "$OUT/read.out" 2>&1
    fi
    code=$?
    printf '%s %s 0\n\n' "$seq" "$code" > "$OUT/read.tmp"
    chgrp hlm-agent "$OUT/read.tmp"; chmod 0640 "$OUT/read.tmp"; mv "$OUT/read.tmp" "$OUT/read.done"
  fi
  rm -f "$pl"
}

case "${1:-}" in
  read) read_req ;;
  cli) dispatch "${2:-}" ;;
  rollback) rollback ;;
  *) echo "usage: $0 read|cli <verb>|rollback" >&2; exit 2 ;;
esac
