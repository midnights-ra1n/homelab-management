//! Hardware inventory, sent with the "info" message at each connection. The management
//! server reads it through the monitoring API to fill its inventory (see server/mg_sync.go).
//! Everything comes from files any user can read (/sys, /proc, /etc/os-release): the DMI
//! serial number is root-only and stays empty under the agent's unprivileged user.

use serde::Serialize;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use sysinfo::Networks;

#[derive(Serialize, Default)]
pub struct Inventory {
    os_version: String,
    cpu_threads: usize,
    cpu_physical: usize,
    cpu_sockets: usize,
    virtualization: String,
    manufacturer: String,
    model: String,
    serial: String,
    install: String,
    ips: Vec<Ip>,
    nics: Vec<Nic>,
    disks: Vec<BlockDev>,
}

#[derive(Serialize)]
struct Ip {
    iface: String,
    address: String,
    prefix: u8,
    mac: String,
}

#[derive(Serialize)]
struct Nic {
    name: String,
    mac: String,
    speed_mbps: u32,
}

#[derive(Serialize)]
struct BlockDev {
    name: String,
    model: String,
    size_bytes: u64,
    rotational: bool,
    kind: &'static str,
}

fn read(p: impl AsRef<Path>) -> String {
    fs::read_to_string(p).map(|s| s.trim().to_string()).unwrap_or_default()
}

/// Interfaces that are not the machine's own network (containers, bridges, VPNs).
fn virtual_iface(name: &str) -> bool {
    name == "lo"
        || ["veth", "docker", "br-", "virbr", "cni", "flannel", "cali", "vxlan", "tun", "tap", "fwbr", "fwln", "fwpr", "vmbr0v"]
            .iter()
            .any(|p| name.starts_with(p))
}

/// Interface of the default route, listed first: its address is the item's primary IP.
fn default_iface() -> String {
    read("/proc/net/route")
        .lines()
        .skip(1)
        .find_map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            (f.len() > 2 && f[1] == "00000000").then(|| f[0].to_string())
        })
        .unwrap_or_default()
}

/// none for bare metal, else what runs the system (kvm, vmware, lxc, docker…).
fn virtualization() -> String {
    let container = read("/run/systemd/container");
    if !container.is_empty() {
        return container;
    }
    if Path::new("/.dockerenv").exists() {
        return "docker".into();
    }
    if read("/proc/1/cgroup").contains("/lxc/") || Path::new("/dev/lxc").exists() {
        return "lxc".into();
    }
    if read("/proc/cpuinfo").lines().any(|l| l.starts_with("flags") && l.contains(" hypervisor")) {
        let vendor = read("/sys/class/dmi/id/sys_vendor").to_lowercase();
        return match () {
            _ if vendor.contains("vmware") => "vmware",
            _ if vendor.contains("microsoft") => "microsoft",
            _ if vendor.contains("xen") => "xen",
            _ if vendor.contains("innotek") || vendor.contains("oracle") => "oracle",
            _ => "kvm",
        }
        .into();
    }
    "none".into()
}

pub fn collect() -> Inventory {
    let cpuinfo = read("/proc/cpuinfo");
    let sockets: BTreeSet<&str> = cpuinfo.lines().filter_map(|l| l.strip_prefix("physical id")).collect();
    let os_release = read("/etc/os-release");
    let version_id = os_release
        .lines()
        .find_map(|l| l.strip_prefix("VERSION_ID="))
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();

    let primary = default_iface();
    let networks = Networks::new_with_refreshed_list();
    let mut ips = Vec::new();
    for (name, data) in &networks {
        if virtual_iface(name) {
            continue;
        }
        for n in data.ip_networks() {
            if n.addr.is_ipv4() && !n.addr.is_loopback() {
                ips.push(Ip { iface: name.clone(), address: n.addr.to_string(), prefix: n.prefix, mac: data.mac_address().to_string() });
            }
        }
    }
    ips.sort_by_key(|i| (i.iface != primary, i.iface.clone()));

    // Physical NICs have a "device" link in sysfs.
    let mut nics = Vec::new();
    if let Ok(dir) = fs::read_dir("/sys/class/net") {
        for e in dir.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if virtual_iface(&name) || !e.path().join("device").exists() {
                continue;
            }
            let speed = read(e.path().join("speed")).parse::<i64>().unwrap_or(0).max(0) as u32;
            nics.push(Nic { mac: read(e.path().join("address")), speed_mbps: speed, name });
        }
    }
    nics.sort_by(|a, b| a.name.cmp(&b.name));

    let mut disks = Vec::new();
    if let Ok(dir) = fs::read_dir("/sys/block") {
        for e in dir.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if ["loop", "ram", "zram", "dm-", "sr", "md", "nbd", "fd"].iter().any(|p| name.starts_with(p)) {
                continue;
            }
            let size = read(e.path().join("size")).parse::<u64>().unwrap_or(0) * 512;
            if size == 0 {
                continue;
            }
            let model = read(e.path().join("device/model"));
            let rotational = read(e.path().join("queue/rotational")) == "1";
            let kind = if name.starts_with("nvme") {
                "nvme"
            } else if name.starts_with("mmcblk") {
                "emmc"
            } else if name.starts_with("vd") || name.starts_with("xvd") || model.contains("QEMU") || model.contains("Virtual") {
                "virtual"
            } else if rotational {
                "hdd"
            } else {
                "ssd"
            };
            disks.push(BlockDev { name, model, size_bytes: size, rotational, kind });
        }
    }
    disks.sort_by(|a, b| a.name.cmp(&b.name));

    let dmi = |f: &str| {
        let v = read(format!("/sys/class/dmi/id/{f}"));
        // Placeholders some vendors leave in the firmware.
        if ["To Be Filled By O.E.M.", "Default string", "System Product Name", "Not Specified"].contains(&v.as_str()) { String::new() } else { v }
    };
    Inventory {
        os_version: version_id,
        cpu_threads: cpuinfo.lines().filter(|l| l.starts_with("processor")).count(),
        cpu_physical: sysinfo::System::physical_core_count().unwrap_or(0),
        cpu_sockets: sockets.len(),
        virtualization: virtualization(),
        manufacturer: dmi("sys_vendor"),
        model: dmi("product_name"),
        serial: dmi("product_serial"),
        install: std::env::var("INSTALL_METHOD").unwrap_or_else(|_| "script".into()),
        ips,
        nics,
        disks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_container_and_bridge_interfaces() {
        for n in ["lo", "veth12ab", "docker0", "br-3f2a", "virbr0", "cni0"] {
            assert!(virtual_iface(n), "{n}");
        }
        for n in ["eth0", "enp3s0", "vmbr0", "wlan0", "eno1"] {
            assert!(!virtual_iface(n), "{n}");
        }
    }
}
