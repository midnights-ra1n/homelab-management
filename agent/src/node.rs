//! Node.js apps of the base-node playbook (its node-app command). node-app runs as root, so the
//! agent only drops requests for the root-owned node-app-helper.sh (hlm-agent-node-read.path,
//! hlm-agent-node-action.path) and reads its answers here. The helper never hands out an app's
//! variables (.env): the structs below would drop them anyway.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::time::UNIX_EPOCH;

pub const HELPER: &str = "/usr/local/lib/hlm-agent/node-app-helper.sh";
const OUT: &str = "/var/lib/hlm-agent/node-apps";
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
fn answer(seq: u64) -> Option<Answer> {
    let done = std::fs::read_to_string(format!("{OUT}/read.done")).ok()?;
    let mut lines = done.lines();
    let mut head = lines.next()?.split(' ');
    if head.next()?.parse::<u64>().ok()? != seq {
        return None;
    }
    let code = head.next()?.parse().ok()?;
    let offset = head.next()?.parse().ok()?;
    let operation = lines.next().and_then(|l| serde_json::from_str(l).ok());
    // shortcut: a multi-byte character cut at the end of a chunk shows as �; fine for logs.
    let text = String::from_utf8_lossy(&std::fs::read(format!("{OUT}/read.out")).unwrap_or_default()).into_owned();
    Some(Answer { code, offset, operation, text })
}

/// Reads go through the helper one at a time: (hub request id, None for a state collection; args).
pub struct Reader {
    seq: u64,
    queue: VecDeque<(Option<String>, Vec<String>)>,
    current: Option<(u64, Option<String>, u64)>, // seq, hub id, started at
}

pub type Finished = (Option<String>, Result<Answer, String>);

impl Reader {
    pub fn new() -> Self {
        // Distinct from the numbers of a previous run, whose answer file may still be there.
        Reader { seq: crate::actions::now() * 1000, queue: VecDeque::new(), current: None }
    }

    pub fn active(&self) -> bool {
        self.current.is_some() || !self.queue.is_empty()
    }

    /// Queues a state collection, unless one is already waiting or running.
    pub fn collect(&mut self) {
        if !self.queue.iter().any(|q| q.0.is_none()) && !self.current.as_ref().is_some_and(|c| c.1.is_none()) {
            self.queue.push_back((None, vec!["collect".into()]));
        }
    }

    /// Queues a read asked by the hub (logs, oplog); refused when too many are waiting.
    pub fn ask(&mut self, id: String, args: Vec<String>) -> Option<Finished> {
        if self.queue.len() >= 8 {
            return Some((Some(id), Err("Trop de lectures en attente sur cet hôte".into())));
        }
        if args.is_empty() || args.len() > 4 || !args.iter().all(|a| safe_word(a)) {
            return Some((Some(id), Err("Lecture invalide".into())));
        }
        self.queue.push_back((Some(id), args));
        None
    }

    /// Starts the next read, or returns the current one once answered (or given up after 40 s).
    pub fn poll(&mut self) -> Option<Finished> {
        let now = crate::actions::now();
        match &self.current {
            None => {
                let (id, args) = self.queue.pop_front()?;
                self.seq += 1;
                match crate::actions::drop_request("node-read", &format!("{} {}", self.seq, args.join(" "))) {
                    Ok(()) => {
                        self.current = Some((self.seq, id, now));
                        None
                    }
                    Err(e) => Some((id, Err(e))),
                }
            }
            Some((seq, _, since)) => {
                let res = match answer(*seq) {
                    Some(a) => Ok(a),
                    None if now > since + 40 => Err("Le helper node-app n'a pas répondu".into()),
                    None => return None,
                };
                let (_, id, _) = self.current.take()?;
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
        assert!(r.ask("x".into(), vec!["logs".into(), "a b".into()]).is_some(), "spaces refused");
        assert!(r.ask("y".into(), vec!["logs".into(), "site".into(), "200".into()]).is_none());
        assert_eq!(r.queue.len(), 2);
    }
}
