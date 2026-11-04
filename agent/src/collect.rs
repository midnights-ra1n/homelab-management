//! Metric collection. Only the subsystems we report are refreshed, so a sample costs
//! a few reads in /proc and /sys.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use sysinfo::{Components, CpuRefreshKind, DiskRefreshKind, Disks, MemoryRefreshKind, RefreshKind, System};

/// Values of HOST_TYPE, same list as hostTypes in server/hosts.go ("auto" or anything else: detected).
const HOST_TYPES: &[&str] = &["proxmox", "physical", "vm", "lxc", "vps"];

// Wire format shared with server/hosts.go (agentInfo / agentMetrics). Keep both in sync.
#[derive(Serialize)]
pub struct Info {
    hostname: String,
    os: String,
    kernel: String,
    arch: String,
    cpu_model: String,
    cpu_cores: usize,
    mem_total: u64,
    agent_version: &'static str,
    boot_time: u64,
    // Proxmox LXC container: node name and CT ID, written to agent.env by install.sh (LXC=all).
    #[serde(skip_serializing_if = "Option::is_none")]
    pve_node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pve_ctid: Option<u32>,
    // Deployment type declared at install (HOST_TYPE in agent.env, Ansible hlm_host_type); None = auto.
    #[serde(skip_serializing_if = "Option::is_none")]
    host_type: Option<String>,
    #[serde(flatten)]
    inventory: crate::inventory::Inventory,
}

#[derive(Serialize)]
pub struct Disk {
    mount: String,
    fs: String,
    used: u64,
    total: u64,
}

#[derive(Serialize)]
pub struct Temp {
    label: String,
    c: f32,
}

#[derive(Serialize)]
pub struct Iface {
    name: String,
    rx: f64,
    tx: f64,
}

#[derive(Serialize)]
pub struct Metrics {
    cpu: f32,
    mem_used: u64,
    mem_total: u64,
    swap_used: u64,
    swap_total: u64,
    disk_used: u64,
    disk_total: u64,
    net_rx: f64,
    net_tx: f64,
    load1: f64,
    temp: Option<f32>,
    cpu_temp: Option<f32>,
    disks: Vec<Disk>,
    temps: Vec<Temp>,
    ifaces: Vec<Iface>,
}

pub struct Collector {
    sys: System,
    disks: Disks,
    comps: Components,
    net_seen: HashMap<String, (u64, u64)>, // counters of the previous sample
    last_net: Instant,
    last_disks: Instant,
    last_sensor_scan: Instant,
}

/// Disk usage barely moves: the 2 s samples of the live view reuse the last reading.
const DISKS_EVERY: Duration = Duration::from_secs(20);
/// New sensors only appear when a driver loads.
const SENSOR_SCAN_EVERY: Duration = Duration::from_secs(600);

const PSEUDO_FS: &[&str] = &[
    "tmpfs", "devtmpfs", "overlay", "squashfs", "proc", "sysfs", "ramfs", "efivarfs", "fuse.lxcfs",
    "fuse", // Proxmox's /etc/pve (pmxcfs)
];

// shortcut: interfaces are excluded by name prefix to avoid counting bridged/virtual
// traffic twice; upgrade to /sys/class/net/*/device detection if a host is miscounted.
const VIRTUAL_IFACES: &[&str] = &[
    "lo", "veth", "docker", "br-", "virbr", "vmbr", "tap", "fwbr", "fwpr", "fwln", "tun", "wg",
    "cni", "flannel", "cali", "vnet",
];

/// (interface, bytes received, bytes sent) from /proc/net/dev: one read for all interfaces,
/// where sysinfo opens eight files per interface (a Proxmox node has one tap or veth per guest).
fn parse_net_dev(text: &str) -> Vec<(&str, u64, u64)> {
    text.lines()
        .skip(2)
        .filter_map(|l| {
            let (name, counters) = l.split_once(':')?;
            let mut c = counters.split_ascii_whitespace();
            Some((name.trim(), c.next()?.parse().ok()?, c.nth(7)?.parse().ok()?))
        })
        .collect()
}

/// CPU temperature from the sensor that best represents the package, by driver label:
/// AMD (k10temp Tctl/Tdie, zenpower), Intel (coretemp Package id 0), ARM SoCs (cpu_thermal),
/// falling back to the hottest Intel core. Virtual machines expose none.
fn cpu_temp(temps: &[Temp]) -> Option<f32> {
    const PREFERRED: &[&str] = &["tctl", "tdie", "package id 0", "cpu_thermal", "soc_thermal", "cpu temp", "zenpower", "k10temp", "cpu"];
    let lower: Vec<(String, f32)> = temps.iter().map(|t| (t.label.to_lowercase(), t.c)).collect();
    PREFERRED
        .iter()
        .find_map(|p| lower.iter().find(|(l, _)| l.contains(p)).map(|(_, c)| *c))
        .or_else(|| lower.iter().filter(|(l, _)| l.starts_with("coretemp core")).map(|(_, c)| *c).reduce(f32::max))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn t(label: &str, c: f32) -> Temp {
        Temp { label: label.into(), c }
    }

    #[test]
    fn parses_proc_net_dev() {
        let text = "Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  1000      10    0    0    0     0          0         0     2000      10    0    0    0     0       0          0
enp1s0:123456789 1000    0    0    0     0          0         0 987654321    900    0    0    0     0       0          0
";
        assert_eq!(parse_net_dev(text), vec![("lo", 1000, 2000), ("enp1s0", 123456789, 987654321)]);
        assert!(parse_net_dev("").is_empty());
    }

    #[test]
    fn picks_the_cpu_sensor() {
        assert_eq!(cpu_temp(&[t("nvme Composite", 61.0), t("k10temp Tctl", 48.5)]), Some(48.5));
        assert_eq!(cpu_temp(&[t("coretemp Core 0", 50.0), t("coretemp Package id 0", 55.0)]), Some(55.0));
        assert_eq!(cpu_temp(&[t("coretemp Core 0", 50.0), t("coretemp Core 1", 53.0)]), Some(53.0));
        assert_eq!(cpu_temp(&[t("cpu_thermal temp1", 45.0)]), Some(45.0));
        assert_eq!(cpu_temp(&[t("nvme Composite", 40.0), t("acpitz temp1", 27.8)]), None);
    }
}

impl Collector {
    pub fn new() -> Self {
        let sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
                .with_memory(MemoryRefreshKind::everything()),
        );
        Collector {
            sys,
            disks: Disks::new_with_refreshed_list_specifics(DiskRefreshKind::nothing().with_storage()),
            comps: Components::new_with_refreshed_list(),
            net_seen: HashMap::new(),
            last_net: Instant::now(),
            last_disks: Instant::now(),
            last_sensor_scan: Instant::now(),
        }
    }

    pub fn info(&self) -> Info {
        let cpus = self.sys.cpus();
        Info {
            hostname: System::host_name().unwrap_or_default(),
            os: System::long_os_version().unwrap_or_default(),
            kernel: System::kernel_version().unwrap_or_default(),
            arch: System::cpu_arch(),
            cpu_model: cpus.first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            cpu_cores: cpus.len(),
            mem_total: self.sys.total_memory(),
            agent_version: crate::VERSION,
            boot_time: System::boot_time(),
            pve_node: std::env::var("PVE_NODE").ok().filter(|n| !n.is_empty()),
            pve_ctid: std::env::var("PVE_CTID").ok().and_then(|id| id.parse().ok()),
            host_type: std::env::var("HOST_TYPE").ok().filter(|t| HOST_TYPES.contains(&t.as_str())),
            inventory: crate::inventory::collect(),
        }
    }

    pub fn collect(&mut self) -> Metrics {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory();
        if self.last_disks.elapsed() >= DISKS_EVERY {
            self.last_disks = Instant::now();
            self.disks.refresh_specifics(true, DiskRefreshKind::nothing().with_storage());
        }
        if self.last_sensor_scan.elapsed() >= SENSOR_SCAN_EVERY {
            self.last_sensor_scan = Instant::now();
            self.comps.refresh(true);
        } else {
            self.comps.list_mut().iter_mut().for_each(|c| c.refresh()); // reads the temperature only
        }

        let mut seen = HashSet::new();
        let mut disks = Vec::new();
        let (mut disk_used, mut disk_total) = (0, 0);
        // A device mounted several times (bind mounts such as the agent's own sandbox paths,
        // btrfs subvolumes) is listed and counted once, under its shortest mount point.
        let mut list: Vec<_> = self.disks.list().iter().collect();
        list.sort_by_key(|d| d.mount_point().as_os_str().len());
        for d in list {
            let fs = d.file_system().to_string_lossy().to_string();
            if PSEUDO_FS.contains(&fs.as_str()) || d.total_space() == 0 || !seen.insert(d.name().to_os_string()) {
                continue;
            }
            let used = d.total_space().saturating_sub(d.available_space());
            disk_used += used;
            disk_total += d.total_space();
            disks.push(Disk {
                mount: d.mount_point().to_string_lossy().to_string(),
                fs,
                used,
                total: d.total_space(),
            });
        }

        let secs = self.last_net.elapsed().as_secs_f64().max(0.001);
        self.last_net = Instant::now();
        let mut ifaces = Vec::new();
        let (mut rx, mut tx) = (0.0, 0.0);
        let net_dev = std::fs::read_to_string("/proc/net/dev").unwrap_or_default();
        let mut seen_now = HashMap::with_capacity(self.net_seen.len());
        for (name, rx_total, tx_total) in parse_net_dev(&net_dev) {
            // First sample of an interface: nothing to compare with. A reset counter reads 0.
            let (rx_before, tx_before) = self.net_seen.get(name).copied().unwrap_or((rx_total, tx_total));
            let (r, t) = (rx_total.saturating_sub(rx_before) as f64 / secs, tx_total.saturating_sub(tx_before) as f64 / secs);
            seen_now.insert(name.to_string(), (rx_total, tx_total));
            if !VIRTUAL_IFACES.iter().any(|p| name.starts_with(p)) {
                rx += r;
                tx += t;
            }
            ifaces.push(Iface { name: name.to_string(), rx: r, tx: t });
        }
        self.net_seen = seen_now;

        let temps: Vec<Temp> = self
            .comps
            .list()
            .iter()
            .filter_map(|c| {
                let t = c.temperature()?;
                (t.is_finite() && t > 0.0).then(|| Temp { label: c.label().to_string(), c: t })
            })
            .collect();

        Metrics {
            cpu: self.sys.global_cpu_usage(),
            mem_used: self.sys.used_memory(),
            mem_total: self.sys.total_memory(),
            swap_used: self.sys.used_swap(),
            swap_total: self.sys.total_swap(),
            disk_used,
            disk_total,
            net_rx: rx,
            net_tx: tx,
            load1: System::load_average().one,
            temp: temps.iter().map(|t| t.c).reduce(f32::max),
            cpu_temp: cpu_temp(&temps),
            disks,
            temps,
            ifaces,
        }
    }
}
