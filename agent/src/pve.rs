//! Proxmox node: the guests it runs, so the hub can show VMs and LXC containers under it.
//! Unprivileged: each guest network port is a bridge port named tap<VMID>i<n> (VM) or
//! veth<CTID>i<n> (container), and the bridge's forwarding database (brforward, readable by
//! everyone) gives the guest MAC addresses learned on that port. The hub matches them with the
//! MAC addresses the guests' own agents report, so nothing has to be installed in the guests.
//! The root helper hlm-agent-lxc (install.sh LXC=all) adds every CT ID of the cluster, which
//! lets the hub drop the hosts of deleted containers.

use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::time::{Duration, SystemTime};

const CTS_FILE: &str = "/var/lib/hlm-agent/lxc/cts";

// Wire format shared with server/guests.go (pveReport). Keep both in sync.
#[derive(Serialize, PartialEq)]
pub struct Report {
    guests: Vec<Guest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cts: Option<Vec<u32>>,
}

#[derive(Serialize, PartialEq)]
struct Guest {
    id: u32,
    kind: &'static str,
    macs: Vec<String>,
}

/// tap101i0 → (101, "vm"), veth105i1 → (105, "ct").
fn guest_port(name: &str) -> Option<(u32, &'static str)> {
    let (rest, kind) = if let Some(r) = name.strip_prefix("tap") {
        (r, "vm")
    } else {
        (name.strip_prefix("veth")?, "ct")
    };
    let (id, nic) = rest.split_once('i')?;
    (!nic.is_empty() && nic.bytes().all(|b| b.is_ascii_digit())).then_some(())?;
    Some((id.parse().ok()?, kind))
}

/// brforward is an array of struct __fdb_entry (16 bytes): MAC, port number (low byte),
/// is_local, ageing timer (4 bytes), port number (high byte), padding.
fn fdb_entries(raw: &[u8]) -> Vec<(String, u16)> {
    raw.chunks_exact(16)
        .filter(|e| e[7] == 0)
        .map(|e| {
            let mac = e[..6].iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":");
            (mac, u16::from(e[6]) | u16::from(e[12]) << 8)
        })
        .collect()
}

fn read_trim(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_default().trim().to_string()
}

pub fn read() -> Option<Report> {
    if !Path::new("/etc/pve").is_dir() {
        return None;
    }
    let mut guests: BTreeMap<(u32, &'static str), BTreeSet<String>> = BTreeMap::new();
    for br in std::fs::read_dir("/sys/class/net").ok()?.flatten() {
        let Ok(ports) = std::fs::read_dir(br.path().join("brif")) else { continue };
        let mut by_port: HashMap<u16, (u32, &'static str)> = HashMap::new();
        for p in ports.flatten() {
            let Some(g) = guest_port(&p.file_name().to_string_lossy()) else { continue };
            guests.entry(g).or_default();
            let no = read_trim(&p.path().join("port_no"));
            if let Ok(no) = u16::from_str_radix(no.trim_start_matches("0x"), 16) {
                by_port.insert(no, g);
            }
        }
        if by_port.is_empty() {
            continue;
        }
        for (mac, port) in fdb_entries(&std::fs::read(br.path().join("brforward")).unwrap_or_default()) {
            if let Some(g) = by_port.get(&port) {
                guests.entry(*g).or_default().insert(mac);
            }
        }
    }
    // A list older than a few runs of the 2-minute timer is not trusted for deletions.
    let fresh = std::fs::metadata(CTS_FILE)
        .and_then(|m| m.modified())
        .is_ok_and(|t| SystemTime::now().duration_since(t).unwrap_or_default() < Duration::from_secs(900));
    let cts = fresh.then(|| {
        std::fs::read_to_string(CTS_FILE).unwrap_or_default().lines().filter_map(|l| l.trim().parse().ok()).collect()
    });
    Some(Report {
        guests: guests
            .into_iter()
            .map(|((id, kind), macs)| Guest { id, kind, macs: macs.into_iter().collect() })
            .collect(),
        cts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_guest_ports() {
        assert_eq!(guest_port("tap101i0"), Some((101, "vm")));
        assert_eq!(guest_port("veth105i12"), Some((105, "ct")));
        assert_eq!(guest_port("vethabc123"), None); // Docker
        assert_eq!(guest_port("veth105i"), None);
        assert_eq!(guest_port("enp3s0"), None);
    }

    #[test]
    fn parses_forwarding_database() {
        let mut raw = vec![0xbc, 0x24, 0x11, 0, 0, 1, 3, 0, 0, 0, 0, 0, 1, 0, 0, 0];
        raw.extend([0xaa, 0xbb, 0xcc, 0, 0, 2, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0]); // local: skipped
        assert_eq!(fdb_entries(&raw), vec![("bc:24:11:00:00:01".to_string(), 0x103)]);
    }
}
