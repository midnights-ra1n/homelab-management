//! Node.js apps of the base-node playbook (its node-app command). node-app runs as root, so the
//! agent only drops requests for the root-owned node-app-helper.sh (hlm-agent-node-read.path,
//! hlm-agent-node-action.path) and reads its answers here. An app's variables (.env), its creation
//! and its deploy key go through hub reads only (answer to the asking user, never stored in the
//! snapshot), and the helper refuses them when the host is read-only (NODE_APPS_ACTIONS=0).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::time::UNIX_EPOCH;

pub const HELPER: &str = "/usr/local/lib/hlm-agent/node-app-helper.sh";
/// Root helper of the firewall (any host): same requests and answers, through its own Reader.
pub const FW_HELPER: &str = "/usr/local/lib/hlm-agent/iptables-helper.sh";
const OUT: &str = "/var/lib/hlm-agent/node-apps";
const FW_OUT: &str = "/var/lib/hlm-agent/iptables";
pub const ACTION_OUTPUT: (&str, &str) = ("/var/lib/hlm-agent/node-apps/action-status.json", "/var/lib/hlm-agent/node-apps/action-log");

// Wire format shared with server/nodeapps.go (nodeApp, nodeOp, nodeKey). Keep both in sync.
#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(default)]
pub struct App {
    name: String,
    port: u64,
    status: String,
    restarts: u64,
    memory_mb: f64,
    failed_commit: Option<String>,
    source: String,
    repo: String,
    branch: String,
    start_command: String,
    migrate_command: String,
    auto_deploy: bool,
    auto_update: bool,
    deployed_commit: String,
    deploy_key: String,
    managed_by_ansible: bool,
    history: Vec<Op>,
}

#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(default)]
pub struct Op {
    id: String,
    kind: String,
    commit: String,
    started: u64,
    finished: Option<u64>,
    result: String,
}

#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(default)]
pub struct Key {
    id: String,
    name: String,
    kind: String,
    #[serde(rename = "type")]
    key_type: String,
    comment: String,
    fingerprint: String,
    created: u64,
    public_key: String,
}

#[derive(Serialize)]
pub struct Snapshot {
    apps: Vec<App>,
    ssh_keys: Vec<Key>,
    ui_port: u64,
    actions: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    collected_at: u64,
}

/// Merges `node-app status --json` with the helper's one-line-per-app details.
fn merge_apps(status: &str, details: &str) -> Vec<App> {
    let mut apps: Vec<Value> = serde_json::from_str(status).unwrap_or_default();
    for line in details.lines() {
        let Ok(Value::Object(d)) = serde_json::from_str::<Value>(line) else { continue };
        match apps.iter_mut().find(|a| a["name"] == d["name"]) {
            Some(Value::Object(a)) => a.extend(d),
            _ => apps.push(Value::Object(d)),
        }
    }
    apps.into_iter().filter_map(|a| serde_json::from_value(a).ok()).collect()
}

/// The helper's last snapshot; None when node-app is absent (no helper output).
pub fn read_snapshot() -> Option<Snapshot> {
    let dir = format!("{OUT}/snapshot");
    let collected_at = std::fs::metadata(&dir).ok()?.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
    let read = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap_or_default();
    Some(Snapshot {
        apps: merge_apps(&read("status.json"), &read("apps.jsonl")),
        ssh_keys: serde_json::from_str(&read("ssh-keys.json")).unwrap_or_default(),
        ui_port: read("ui-port").trim().parse().unwrap_or(0),
        actions: std::path::Path::new(&format!("{dir}/actions")).exists(),
        error: Some(read("error").trim().chars().take(500).collect::<String>()).filter(|e| !e.is_empty()),
        collected_at,
    })
}

fn safe_word(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Asks the root helper to run one node-app action (deploy, pull, update, restart, stop, remove, purge).
pub fn request_action(verb: &str, app: &str) -> Result<(), String> {
    if !std::path::Path::new("/etc/systemd/system/hlm-agent-node-action.path").exists() {
        return Err("Actions sur les applications Node.js non installées sur cette machine (relancez install.sh, sans NODE_APPS_ACTIONS=0)".into());
    }
    if !["deploy", "pull", "update", "restart", "stop", "remove", "purge"].contains(&verb) || !safe_word(app) {
        return Err("Action ou nom d'application invalide".into());
    }
    crate::actions::drop_request("node-action", &format!("{verb} {app}"))
}

pub struct Answer {
    pub code: i64,
    pub offset: u64,
    pub operation: Option<Value>,
    pub text: String,
}

/// The helper's answer to read number `seq`, once written: "<seq> <code> <offset>\n<operation>".
fn answer(out: &str, seq: u64) -> Option<Answer> {
    let done = std::fs::read_to_string(format!("{out}/read.done")).ok()?;
    let mut lines = done.lines();
    let mut head = lines.next()?.split(' ');
    if head.next()?.parse::<u64>().ok()? != seq {
        return None;
    }
    let code = head.next()?.parse().ok()?;
    let offset = head.next()?.parse().ok()?;
    let operation = lines.next().and_then(|l| serde_json::from_str(l).ok());
    // shortcut: a multi-byte character cut at the end of a chunk shows as �; fine for logs.
    let text = String::from_utf8_lossy(&std::fs::read(format!("{out}/read.out")).unwrap_or_default()).into_owned();
    Some(Answer { code, offset, operation, text })
}

/// Reads go through the helper one at a time: (hub request id, None for a state collection; args).
pub struct Reader {
    out: &'static str,
    request: &'static str,
    payload: &'static str,
    seq: u64,
    queue: VecDeque<(Option<String>, Vec<String>, Option<String>)>, // hub id, args, payload
    current: Option<(u64, Option<String>, u64, u64)>, // seq, hub id, started at, timeout (s)
}

pub type Finished = (Option<String>, Result<Answer, String>);

/// The answer to a hub read, for the websocket.
pub fn reply(id: String, res: Result<Answer, String>) -> Value {
    match res {
        Ok(a) if a.code == 0 => serde_json::json!({"type": "node_read", "read": {"id": id, "ok": true, "text": a.text, "offset": a.offset, "operation": a.operation}}),
        Ok(a) => {
            let tail: String = a.text.chars().rev().take(500).collect::<Vec<_>>().into_iter().rev().collect();
            serde_json::json!({"type": "node_read", "read": {"id": id, "ok": false, "error": tail.trim()}})
        }
        Err(e) => serde_json::json!({"type": "node_read", "read": {"id": id, "ok": false, "error": e}}),
    }
}

/// Hub reads that change the host (the state is collected again after them).
pub const WRITES: &[&str] = &["setenv", "create", "newkey", "importkey", "pause", "resume"];
/// Largest payload (.env text, creation request, private key) handed to the helper.
const MAX_PAYLOAD: usize = 256 * 1024;

impl Reader {
    fn with(out: &'static str, request: &'static str, payload: &'static str) -> Self {
        // Distinct from the numbers of a previous run, whose answer file may still be there.
        Reader { out, request, payload, seq: crate::actions::now() * 1000, queue: VecDeque::new(), current: None }
    }

    pub fn new() -> Self {
        Self::with(OUT, "node-read", "node-payload")
    }

    pub fn firewall() -> Self {
        Self::with(FW_OUT, "iptables-read", "iptables-payload")
    }

    pub fn active(&self) -> bool {
        self.current.is_some() || !self.queue.is_empty()
    }

    /// Queues a state collection, unless one is already waiting or running.
    pub fn collect(&mut self) {
        if !self.queue.iter().any(|q| q.0.is_none()) && !self.current.as_ref().is_some_and(|c| c.1.is_none()) {
            self.queue.push_back((None, vec!["collect".into()], None));
        }
    }

    /// Queues a read asked by the hub (logs, oplog, env…), with its payload for the helper
    /// (written to the state directory, never logged); refused when too many are waiting.
    pub fn ask(&mut self, id: String, args: Vec<String>, payload: Option<String>) -> Option<Finished> {
        if self.queue.len() >= 8 {
            return Some((Some(id), Err("Trop de lectures en attente sur cet hôte".into())));
        }
        if args.is_empty() || args.len() > 4 || !args.iter().all(|a| safe_word(a)) || payload.as_ref().is_some_and(|p| p.len() > MAX_PAYLOAD) {
            return Some((Some(id), Err("Lecture invalide".into())));
        }
        self.queue.push_back((Some(id), args, payload));
        None
    }

    /// Starts the next read, or returns the current one once answered (or given up after 40 s).
    pub fn poll(&mut self) -> Option<Finished> {
        let now = crate::actions::now();
        match &self.current {
            None => {
                let (id, args, payload) = self.queue.pop_front()?;
                self.seq += 1;
                // Cloning a repository or restarting an app can take minutes; reads answer within seconds.
                let timeout = match args[0].as_str() { "create" => 600, "setenv" | "fw-install" => 300, "pause" | "resume" => 130, _ => 40 };
                // Written only when there is one (the helper deletes it at each read): no disk write per collection.
                let dropped = payload.as_deref().map_or(Ok(()), |p| crate::actions::drop_request(self.payload, p));
                match dropped.and_then(|_| crate::actions::drop_request(self.request, &format!("{} {}", self.seq, args.join(" ")))) {
                    Ok(()) => {
                        self.current = Some((self.seq, id, now, timeout));
                        None
                    }
                    Err(e) => Some((id, Err(e))),
                }
            }
            Some((seq, _, since, timeout)) => {
                let res = match answer(self.out, *seq) {
                    Some(a) => Ok(a),
                    None if now > since + timeout => Err("Le helper root n'a pas répondu".into()),
                    None => return None,
                };
                let (_, id, _, _) = self.current.take()?;
                Some((id, res))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_status_and_details_without_secrets() {
        let status = r#"[{"name":"site","port":3000,"status":"online","restarts":1,"memory_mb":84,"failed_commit":null},
                         {"name":"api","port":3001,"status":"errored","restarts":9,"memory_mb":0,"failed_commit":"9b1e4c2"}]"#;
        let details = concat!(
            r#"{"name":"site","source":"git","repo":"git@github.com:moi/site.git","auto_deploy":true,"env":{"DATABASE_URL":"secret"},"history":[{"id":"20261023-141502-deploy","kind":"deploy","commit":"3f9c","started":1,"finished":null,"result":"running"}]}"#,
            "\nnot json\n"
        );
        let apps = merge_apps(status, details);
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].port, 3000);
        assert!(apps[0].auto_deploy);
        assert_eq!(apps[0].history[0].finished, None);
        assert_eq!(apps[1].failed_commit.as_deref(), Some("9b1e4c2"));
        let json = serde_json::to_string(&apps).unwrap();
        assert!(!json.contains("secret") && !json.contains("\"env\""), "{json}");
    }

    #[test]
    fn reader_runs_one_read_at_a_time() {
        let mut r = Reader::new();
        r.collect();
        r.collect();
        assert_eq!(r.queue.len(), 1, "one collection queued");
        assert!(r.ask("x".into(), vec!["logs".into(), "a b".into()], None).is_some(), "spaces refused");
        assert!(r.ask("y".into(), vec!["logs".into(), "site".into(), "200".into()], None).is_none());
        assert!(r.ask("z".into(), vec!["setenv".into(), "site".into()], Some("A=1\n".repeat(100_000))).is_some(), "payload too large");
        assert!(r.ask("z".into(), vec!["setenv".into(), "site".into()], Some("A=1\n".into())).is_none());
        assert_eq!(r.queue.len(), 3);
    }

    /// Runs agent/iptables-helper.sh (bash) with fake firewall tools that log their arguments.
    fn helper(dir: &std::path::Path, verb: &str, payload: &str) -> (bool, String, String) {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;
        use std::process::{Command, Stdio};
        const SAVE: &str = "*filter\n:INPUT DROP [0:0]\n:FW-INPUT - [3:120]\n-A INPUT -j FW-INPUT\n-A FW-INPUT -p tcp -m comment --comment \"mon site\" -j ACCEPT\nCOMMIT\n";
        let bin = dir.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        for tool in ["iptables", "ip6tables", "iptables-restore", "ip6tables-restore", "systemd-run", "systemctl", "netfilter-persistent", "iptables-save"] {
            let body = match tool {
                "iptables-save" => format!("printf '{}'", SAVE.replace('%', "%%")),
                "systemctl" => "[ \"$1\" = is-active ] && exit 1\nexit 0".into(),
                "iptables-restore" => format!("{{ echo \"$0\"; cat; }} >> {0}/calls", dir.display()),
                _ => format!("echo \"$0 $*\" >> {0}/calls; case \"$*\" in *' -I '*) [ -f {0}/fail ] && exit 4 ;; esac; exit 0", dir.display()),
            };
            let f = bin.join(tool);
            std::fs::write(&f, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let mut c = Command::new("bash")
            .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/iptables-helper.sh"))
            .args(if verb == "rollback" { vec![verb] } else { vec!["cli", verb] })
            .env("PATH", format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()))
            .env("HLM_IPTABLES_RUN", dir.join("run"))
            .env("HLM_IPTABLES_RULES", dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        c.stdin.take().unwrap().write_all(payload.as_bytes()).unwrap();
        let o = c.wait_with_output().unwrap();
        let calls = std::fs::read_to_string(dir.join("calls")).unwrap_or_default();
        let _ = std::fs::remove_file(dir.join("calls"));
        (o.status.success(), String::from_utf8_lossy(&o.stdout).into_owned(), calls)
    }

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("hlm-ipt-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn firewall_lists_rules_as_json() {
        let d = tmp("list");
        let (ok, out, _) = helper(&d, "fw-list", "");
        assert!(ok, "{out}");
        let v: Value = serde_json::from_str(&out).unwrap_or_else(|e| panic!("{e}: {out}"));
        assert_eq!(v["persistent"], true);
        let chains = &v["families"][0]["tables"][0]["chains"];
        assert_eq!(chains[0]["policy"], "DROP");
        assert_eq!(chains[1]["name"], "FW-INPUT");
        assert_eq!(chains[1]["rules"][0], "-A FW-INPUT -p tcp -m comment --comment \"mon site\" -j ACCEPT");
        assert_eq!(v["families"][0]["saved"], false);
        std::fs::write(d.join("rules.v4"), "# Generated\n*filter\n:INPUT DROP [9:9]\n:FW-INPUT - [0:0]\n-A INPUT -j FW-INPUT\n-A FW-INPUT -p tcp -m comment --comment \"mon site\" -j ACCEPT\nCOMMIT\n").unwrap();
        let (_, out, _) = helper(&d, "fw-list", "");
        assert_eq!(serde_json::from_str::<Value>(&out).unwrap()["families"][0]["saved"], true, "{out}");
    }

    #[test]
    fn firewall_changes_pass_one_checked_argument_each_and_arm_the_rollback() {
        let d = tmp("add");
        let add = "op=add\nfamily=4\nchain=INPUT\nposition=top\nproto=tcp\ndport=8000:8100\nsource=10.0.0.0/8\ncomment=site web\ntarget=ACCEPT\n";
        let (ok, out, calls) = helper(&d, "fw-apply", add);
        assert!(ok, "{out}");
        assert!(calls.contains("systemd-run --quiet --collect --on-active=60 --unit=hlm-iptables-rollback"), "{calls}");
        assert!(calls.contains("-t filter -I INPUT 1 -p tcp --dport 8000:8100 -s 10.0.0.0/8 -m comment --comment site web -j ACCEPT"), "{calls}");
        assert!(d.join("run/rollback.iptables").exists());
        helper(&d, "fw-confirm", "");
        assert!(!d.join("run/rollback.iptables").exists());

        let (ok, out, calls) = helper(&d, "fw-apply", "op=delete\nfamily=4\nrule=-A INPUT -j FW-INPUT\n");
        assert!(ok, "{out}");
        assert!(calls.contains("*filter\n-D INPUT -j FW-INPUT\nCOMMIT"), "{calls}");

        // Past the delay, the saved rules come back.
        let (ok, out, calls) = helper(&d, "rollback", "");
        assert!(ok, "{out}");
        assert!(calls.contains("iptables-restore\n*filter\n:INPUT DROP"), "{calls}");
        assert!(!d.join("run/rollback.iptables").exists());

        // A failed change does not wait for the rollback.
        std::fs::write(d.join("fail"), "").unwrap();
        let (ok, _, calls) = helper(&d, "fw-apply", add);
        assert!(!ok, "{calls}");
        assert!(!d.join("run/rollback.iptables").exists());
    }

    #[test]
    fn firewall_refuses_what_it_cannot_check() {
        let d = tmp("bad");
        let base = "op=add\nfamily=4\nchain=INPUT\nposition=top\nproto=tcp\ntarget=ACCEPT\n";
        for bad in [
            "dport=99999\n", "dport=1;reboot\n", "source=1.2.3.4 --modprobe=/tmp/x\n", "iface=-x\n", "comment=a\"b\n", "comment=$(id)\n",
            "chain=--modprobe=/tmp/x\n", "target=LOG\n", "position=9\n", "family=5\n", "proto=gre\n", "proto=all\ndport=22\n", "op=flush\n",
        ] {
            let (ok, _, calls) = helper(&d, "fw-apply", &format!("{base}{bad}"));
            assert!(!ok, "accepted: {bad}");
            assert!(!calls.contains("-j ACCEPT"), "{bad}: {calls}");
        }
        for bad in ["rule=-A INPUT --modprobe=/tmp/x -j ACCEPT\n", "rule=-F\n", "rule=-A INPUT -j FW-INPUT\nfamily=4\nrule=x\n"] {
            assert!(!helper(&d, "fw-apply", &format!("op=delete\nfamily=4\n{bad}")).0, "accepted: {bad}");
        }
        assert!(!helper(&d, "fw-apply", "op=policy\nfamily=4\nchain=FW-INPUT\npolicy=DROP\n").0);
        assert!(!helper(&d, "fw-flush", "").0);
    }

    #[test]
    fn firewall_save_uses_netfilter_persistent_without_fail2ban_chains() {
        let d = tmp("save");
        std::fs::write(d.join("rules.v4"), "*filter\n:INPUT DROP [0:0]\n:f2b-sshd - [0:0]\n-A INPUT -p tcp -j f2b-sshd\n-A INPUT -j FW-INPUT\n-A f2b-sshd -s 1.2.3.4/32 -j REJECT\nCOMMIT\n").unwrap();
        let (ok, out, calls) = helper(&d, "fw-save", "");
        assert!(ok, "{out}");
        assert!(calls.contains("netfilter-persistent save"), "{calls}");
        assert_eq!(std::fs::read_to_string(d.join("rules.v4")).unwrap(), "*filter\n:INPUT DROP [0:0]\n-A INPUT -j FW-INPUT\nCOMMIT\n");
    }
}
