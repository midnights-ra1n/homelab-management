#!/bin/bash
# Node.js apps of the base-node playbook (its node-app command) for hlm-agent. node-app must run
# as root (it reads /etc/node-apps and /var/log/node-app, drives PM2 and iptables), so the
# unprivileged agent goes through this root-owned script, which takes one request file:
#   read    (hlm-agent-node-read.path): "<seq> collect", "<seq> logs <app> <lines>",
#           "<seq> oplog <app> <id> <offset>", and, unless the host is read-only (no action
#           unit), the requests of node-app-ui that carry secrets, answered to the asking user
#           only: "env", "setenv", "key", "newkey", "importkey" and "create" <app>, with their
#           payload (.env text, private key, creation JSON) in the agent's node-payload file.
#           "pauseshow", "pausepreview", "pause" (page JSON as payload) and "resume" <app>: the
#           pause page of an app, the last two refused on a read-only host.
#   action  (hlm-agent-node-action.path, absent with NODE_APPS_ACTIONS=0): "<verb> <app>",
#           verb = deploy, pull, update (started with systemd-run, followed in the history),
#           restart, stop, remove or purge.
# Formats of node-app: NODE-APP-API.md of the base-node playbook.
set -u
NODE_APP=/usr/local/bin/node-app
OUT=/var/lib/hlm-agent/node-apps
STATE=/var/lib/hlm-agent/state
MAX=262144 # bytes of log sent per read, and of payload taken
[ -x "$NODE_APP" ] || exit 0
install -d -o root -g hlm-agent -m 0750 "$OUT"

publish() { chgrp hlm-agent "$1" && chmod 0640 "$1"; }
valid_app() { [[ $1 =~ ^[a-z0-9][a-z0-9_-]*$ ]] && [ -f "/etc/node-apps/$1.conf" ]; }

# One line from the request file the agent dropped, restricted to safe characters.
take() {
  local req=$STATE/$1
  [ -f "$req" ] && [ ! -L "$req" ] || { rm -f "$req"; return; }
  head -c 300 "$req" | head -n1 | tr -dc 'A-Za-z0-9 _-'
  rm -f "$req"
}

# The payload the agent dropped with its read (untrusted: size-capped, never a link), into $1.
take_payload() {
  local f=$STATE/node-payload
  [ -f "$f" ] && [ ! -L "$f" ] && head -c "$MAX" "$f" > "$1"
  rm -f "$f"
}
can_write() { [ -e /etc/systemd/system/hlm-agent-node-action.path ]; }
as_json() { node -e 'const fs = require("fs"); console.log(JSON.stringify({ [process.argv[1]]: fs.readFileSync(0, "utf8").trim() }))' "$1"; }

# Creation request of node-app-ui (POST /api/apps) checked, then turned into node-app create options
# (NUL-separated on stdout), its .env text into $2 and its private key into $3. Git sources only:
# a path on the server would let the hub copy any root-readable file into an app.
CREATE_JS='
const fs = require("fs");
const fail = (m) => { console.log(m); process.exit(1); };
let b;
try { b = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { fail("Requête de création invalide"); }
if (!b || typeof b !== "object") fail("Requête de création invalide");
const opt = (k, re, msg) => {
  const v = b[k];
  if (v === undefined || v === null || v === "") return "";
  if ((typeof v !== "string" && typeof v !== "number") || !re.test(String(v))) fail(msg);
  return String(v);
};
const src = opt("source", /^(https?:\/\/|ssh:\/\/|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:)[^\s]{1,490}$/, "Source invalide : URL git attendue (https://… ou git@hôte:compte/dépôt.git)");
if (!src) fail("Source du code manquante");
const args = ["--repo", src, "--no-deploy", "--auto-deploy", b.auto_deploy === false ? "non" : "oui", "--auto-update", b.auto_update === false ? "non" : "oui"];
const add = (flag, v) => v && args.push(flag, v);
add("--branch", opt("branch", /^[A-Za-z0-9._][A-Za-z0-9._\/-]{0,199}$/, "Branche ou tag invalide"));
const port = opt("port", /^[0-9]{1,5}$/, "Port invalide");
if (port && (+port < 1 || +port > 65535)) fail("Port invalide");
add("--port", port);
add("--preset", opt("preset", /^[a-z][a-z-]{0,29}$/, "Préréglage invalide"));
add("--start", opt("start", /^[^\n\r\0]{1,500}$/, "Commande de démarrage invalide"));
add("--migrate", opt("migrate", /^[^\n\r\0]{1,500}$/, "Commande de migration invalide"));
if (typeof b.env === "string" && b.env.trim()) {
  fs.writeFileSync(process.argv[2], b.env);
  args.push("--env-stdin");
  if (b.env_merge === "saisie" || b.env_merge === "code") args.push("--env-merge", b.env_merge);
}
if (typeof b.private_key === "string" && b.private_key.trim()) fs.writeFileSync(process.argv[3], b.private_key);
process.stdout.write(args.join("\0"));'

# node-app create, like node-app-ui: recorded without deploying (errors right away), then
# deployed in the background. Answers JSON: {"warnings"} or {"need_key"} (deploy key to add).
create_app() { # app payload
  local app=$1 tmp rc args=()
  tmp=$(mktemp -d)
  if ! node -e "$CREATE_JS" "$2" "$tmp/env" "$tmp/key" > "$tmp/args"; then
    cp "$tmp/args" "$OUT/read.out"; rm -rf "$tmp"; return 1
  fi
  mapfile -d '' -t args < "$tmp/args"
  if [ -f "/etc/node-apps/$app.conf" ]; then
    echo "L'application $app existe déjà" > "$OUT/read.out"; rm -rf "$tmp"; return 1
  fi
  if [ -s "$tmp/key" ] && ! "$NODE_APP" key "$app" --import < "$tmp/key" > /dev/null 2> "$OUT/read.out"; then
    rm -rf "$tmp"; return 1
  fi
  [ -f "$tmp/env" ] || : > "$tmp/env"
  timeout 9m "$NODE_APP" create "$app" "${args[@]}" < "$tmp/env" > "$tmp/out" 2> "$tmp/err"
  rc=$?
  if [ "$rc" -eq 3 ]; then
    "$NODE_APP" key "$app" 2>/dev/null | as_json need_key > "$OUT/read.out"; rc=0
  elif [ "$rc" -ne 0 ]; then
    if [ -s "$tmp/err" ]; then cp "$tmp/err" "$OUT/read.out"; else cp "$tmp/out" "$OUT/read.out"; fi
  else
    systemd-run --no-block --collect --quiet --unit="node-app-deploy-$app-$(date +%s)" "$NODE_APP" deploy "$app" --force
    as_json warnings < "$tmp/err" > "$OUT/read.out"
  fi
  rm -rf "$tmp"
  return "$rc"
}

# One app as JSON: its settings (.conf, sourced like node-app does) and its last 20 operations.
APP_JS='
const fs = require("fs"), e = process.env, byId = new Map();
let lines = [];
try { lines = fs.readFileSync(process.argv[1], "utf8").split("\n"); } catch {}
for (const l of lines) { try { const o = JSON.parse(l); byId.set(o.id, o); } catch {} }
console.log(JSON.stringify({
  name: e.X_NAME, source: e.X_REPO ? "git" : "local",
  repo: (e.X_REPO || "").replace(/\/\/[^@\/]*@/, "//•••@"), branch: e.X_BRANCH,
  start_command: e.X_START, migrate_command: e.X_MIG,
  auto_deploy: e.X_AD === "oui", auto_update: e.X_AU === "oui",
  deployed_commit: e.X_REV, deploy_key: e.X_KEY, managed_by_ansible: e.X_MANAGED !== "0",
  history: [...byId.values()].reverse().slice(0, 20),
}));'

collect() {
  local new=$OUT/.snapshot.new c app
  rm -rf "$new"; mkdir -m 0750 "$new"
  timeout 60 "$NODE_APP" status --json > "$new/status.json" 2> "$new/error" || echo '[]' > "$new/status.json"
  : > "$new/apps.jsonl"
  for c in /etc/node-apps/*.conf; do
    [ -e "$c" ] || continue
    app=$(basename "$c" .conf)
    [[ $app =~ ^[a-z0-9][a-z0-9_-]*$ ]] || continue
    ( PORT='' START_CMD='' MIGRATE_CMD='' REPO='' BRANCH='' AUTO_UPDATE='' AUTO_DEPLOY=''
      . "$c"
      X_NAME=$app X_START=$START_CMD X_MIG=$MIGRATE_CMD X_REPO=$REPO X_BRANCH=$BRANCH X_AD=$AUTO_DEPLOY X_AU=$AUTO_UPDATE \
      X_REV=$(cat "/etc/node-apps/$app.rev" 2>/dev/null) X_KEY=$(cat "/srv/node-apps/.ssh/${app}_ed25519.pub" 2>/dev/null) \
      X_MANAGED=$(grep -c "Ansible managed" "$c") \
      node -e "$APP_JS" "/var/log/node-app/$app/history.jsonl" ) >> "$new/apps.jsonl" 2>>"$new/error"
  done
  timeout 30 "$NODE_APP" ssh-key list > "$new/ssh-keys.json" 2>/dev/null || echo '[]' > "$new/ssh-keys.json"
  node -e 'try { console.log(require("/etc/node-app-ui/config.json").port || 0) } catch { console.log(0) }' > "$new/ui-port" 2>/dev/null
  [ -e /etc/systemd/system/hlm-agent-node-action.path ] && touch "$new/actions"
  [ -s "$new/error" ] || rm -f "$new/error"
  for f in "$new"/*; do [ -e "$f" ] && publish "$f"; done
  chgrp hlm-agent "$new"
  rm -rf "$OUT/.snapshot.old"
  [ -d "$OUT/snapshot" ] && mv "$OUT/snapshot" "$OUT/.snapshot.old"
  mv "$new" "$OUT/snapshot"
  rm -rf "$OUT/.snapshot.old"
}

# Answer of a read: read.out (text), then read.done = "<seq> <code> <offset>" and the operation.
answer() { # seq code offset [operation json]
  printf '%s %s %s\n%s\n' "$1" "$2" "$3" "${4:-}" > "$OUT/read.tmp"
  publish "$OUT/read.tmp"; mv "$OUT/read.tmp" "$OUT/read.done"
}

read_req() {
  local line seq verb app arg off f size op pl
  line=$(take node-read)
  pl=$(mktemp)
  trap 'rm -f "$pl"' EXIT
  take_payload "$pl"
  read -r seq verb app arg off _ <<< "$line"
  [[ ${seq:-} =~ ^[0-9]{1,18}$ ]] || exit 0
  : > "$OUT/read.out"; publish "$OUT/read.out"
  case "${verb:-}" in
    env | setenv | key | newkey | importkey | create | pause | resume)
      if ! can_write; then echo "Hôte en lecture seule (NODE_APPS_ACTIONS=0)" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; fi ;;
  esac
  case "${verb:-}" in
    collect) collect; answer "$seq" 0 0 ;;
    logs)
      valid_app "${app:-}" && [[ ${arg:-} =~ ^[0-9]{2,4}$ ]] && ((arg <= 2000)) || { echo "Requête refusée" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; }
      timeout 20 "$NODE_APP" logs "$app" "$arg" --nostream 2>&1 | tail -c "$MAX" > "$OUT/read.out"
      answer "$seq" "${PIPESTATUS[0]}" 0 ;;
    oplog)
      f=/var/log/node-app/${app:-}/${arg:-}.log
      valid_app "${app:-}" && [[ ${arg:-} =~ ^[0-9]{8}-[0-9]{6}-[a-z-]+$ ]] && [[ ${off:-} =~ ^[0-9]{1,12}$ ]] && [ -f "$f" ] \
        || { echo "Opération introuvable" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; }
      size=$(stat -c %s "$f")
      ((off > size)) && off=0 # log rotated or rewritten
      tail -c +$((off + 1)) "$f" | head -c "$MAX" > "$OUT/read.out"
      op=$(grep -F "\"id\":\"$arg\"" "/var/log/node-app/$app/history.jsonl" 2>/dev/null | tail -n1)
      answer "$seq" 0 $((off + $(stat -c %s "$OUT/read.out"))) "$op" ;;
    env)
      valid_app "${app:-}" || { echo "Application inconnue" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; }
      head -c "$MAX" "/etc/node-apps/$app.env" > "$OUT/read.out" 2>/dev/null
      answer "$seq" 0 0 ;;
    setenv)
      valid_app "${app:-}" || { echo "Application inconnue" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; }
      timeout 5m "$NODE_APP" env "$app" --stdin < "$pl" > "$OUT/read.out" 2>&1
      answer "$seq" "$?" 0 ;;
    pauseshow | pause | resume)
      valid_app "${app:-}" || { echo "Application inconnue" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; }
      case "$verb" in
        pauseshow) timeout 20 "$NODE_APP" pause "$app" --show ;;
        pause) timeout 2m "$NODE_APP" pause "$app" --stdin < "$pl" ;;
        resume) timeout 2m "$NODE_APP" resume "$app" ;;
      esac > "$OUT/read.out" 2>&1
      answer "$seq" "$?" 0 ;;
    pausepreview)
      timeout 20 "$NODE_APP" pause-render < "$pl" > "$OUT/read.out" 2>&1
      answer "$seq" "$?" 0 ;;
    key | newkey | importkey)
      # Before its creation too (private repository): the name only has to be valid.
      [[ ${app:-} =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "Nom invalide" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; }
      case "$verb" in
        key) timeout 1m "$NODE_APP" key "$app" ;;
        newkey) timeout 1m "$NODE_APP" key "$app" --new ;;
        importkey) timeout 1m "$NODE_APP" key "$app" --import < "$pl" ;;
      esac > "$OUT/read.out" 2>&1
      answer "$seq" "$?" 0 ;;
    create)
      [[ ${app:-} =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "Nom invalide (minuscules, chiffres, - et _)" > "$OUT/read.out"; answer "$seq" 1 0; exit 0; }
      create_app "$app" "$pl"
      answer "$seq" "$?" 0 ;;
    *) echo "Requête refusée" > "$OUT/read.out"; answer "$seq" 1 0 ;;
  esac
}

status() { # state exit_code
  printf '{"action":"node_%s","target":"%s","state":"%s","exit_code":%s,"finished_at":%s}\n' "$verb" "$app" "$1" "$2" "$(date +%s)" > "$OUT/action-status.tmp"
  publish "$OUT/action-status.tmp"; mv "$OUT/action-status.tmp" "$OUT/action-status.json"
}

# Long operations run outside this unit, like node-app-ui does: no time limit, and they
# survive a restart of the agent. Waits for their line in the history (up to 20 s).
background() {
  local t0 h=/var/log/node-app/$app/history.jsonl before after
  t0=$(date +%s)
  before=$(tail -n1 "$h" 2>/dev/null)
  echo "\$ node-app $*" >> "$log"
  systemd-run --no-block --collect --quiet --unit="node-app-$1-$app-$t0" "$NODE_APP" "$@" >> "$log" 2>&1 || return 1
  for _ in $(seq 20); do
    sleep 1
    after=$(tail -n1 "$h" 2>/dev/null)
    if [ "$after" != "$before" ]; then # history is capped at 200 lines: compare the last one
      echo "Opération $(sed -n 's/.*"id":"\([^"]*\)".*/\1/p' <<< "$after") lancée, suivie dans l'historique." >> "$log"
      return 0
    fi
  done
  echo "Lancé ; aucune opération n'a démarré en 20 s (pas de nouveau commit, ou une autre opération est en cours : elle attend son tour)." >> "$log"
}

action() {
  local line verb app rc=0
  line=$(take node-action)
  read -r verb app _ <<< "$line"
  [ -n "${verb:-}" ] || exit 0
  log=$OUT/action-log
  : > "$log"; publish "$log"
  status running null
  if ! valid_app "${app:-}"; then
    echo "Application inconnue : ${app:-}" >> "$log"; status failed 1; exit 0
  fi
  case "$verb" in
    deploy) background deploy "$app" --force ;;
    pull) background deploy "$app" ;;
    update) background update "$app" ;;
    restart | stop) timeout 10m "$NODE_APP" "$verb" "$app" >> "$log" 2>&1 ;;
    remove) timeout 10m "$NODE_APP" remove "$app" --yes >> "$log" 2>&1 ;;
    purge) timeout 10m "$NODE_APP" remove "$app" --yes --purge >> "$log" 2>&1 ;;
    *) echo "Action refusée : $verb" >> "$log"; false ;;
  esac
  rc=$?
  collect
  if [ "$rc" -eq 0 ]; then status done 0; else status failed "$rc"; fi
}

case "${1:-}" in
  read) read_req ;;
  action) action ;;
  *) echo "usage: $0 read|action" >&2; exit 2 ;;
esac
