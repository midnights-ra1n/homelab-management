/** Libellés et teintes partagés par l'interface. */

export type Tone = "accent" | "green" | "yellow" | "red" | "blue" | "purple" | "cyan" | "orange" | "pink" | "muted";

export const TONES: Tone[] = ["accent", "green", "yellow", "red", "blue", "purple", "cyan", "orange", "pink", "muted"];

export const ASSET_KINDS = ["physical", "vm", "lxc", "docker", "network", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_KIND_META: Record<AssetKind, { label: string; plural: string; tone: Tone }> = {
  physical: { label: "Serveur physique", plural: "Serveurs physiques", tone: "accent" },
  vm: { label: "Machine virtuelle", plural: "Machines virtuelles", tone: "blue" },
  lxc: { label: "Conteneur LXC", plural: "Conteneurs LXC", tone: "purple" },
  docker: { label: "Conteneur Docker", plural: "Conteneurs Docker", tone: "cyan" },
  network: { label: "Équipement réseau", plural: "Équipements réseau", tone: "orange" },
  other: { label: "Autre", plural: "Autres", tone: "muted" },
};

export const ASSET_STATUSES = ["online", "offline", "maintenance", "planned", "decommissioned"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_META: Record<AssetStatus, { label: string; tone: Tone }> = {
  online: { label: "En ligne", tone: "green" },
  offline: { label: "Hors ligne", tone: "red" },
  maintenance: { label: "Maintenance", tone: "yellow" },
  planned: { label: "Planifié", tone: "blue" },
  decommissioned: { label: "Retiré", tone: "muted" },
};

/** Origine de l'état détecté automatiquement (colonne assets.status_source). */
export const STATUS_SOURCE_LABEL: Record<string, string> = {
  ping: "ping",
  // Anciennes détections (avant le passage au ping seul), encore présentes jusqu'au prochain passage.
  proxmox: "Proxmox",
  hlm: "Homelab Monitoring",
  beszel: "Beszel",
  maintenant: "Maintenant",
  tcp: "sonde réseau",
};

export const DEPLOYMENT_KINDS = ["physical", "vm", "lxc", "docker", "application", "other"] as const;
export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];

export const DEPLOYMENT_KIND_META: Record<DeploymentKind, { label: string; tone: Tone }> = {
  physical: { label: "Serveur physique", tone: "accent" },
  vm: { label: "VM", tone: "blue" },
  lxc: { label: "CT LXC", tone: "purple" },
  docker: { label: "Docker", tone: "cyan" },
  application: { label: "Application", tone: "pink" },
  other: { label: "Autre", tone: "muted" },
};

export const DEPLOYMENT_STATUSES = ["planned", "preparing", "in_progress", "testing", "blocked", "done", "cancelled"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_STATUS_META: Record<DeploymentStatus, { label: string; tone: Tone }> = {
  planned: { label: "Planifié", tone: "muted" },
  preparing: { label: "Préparation", tone: "blue" },
  in_progress: { label: "En cours", tone: "accent" },
  testing: { label: "Tests", tone: "purple" },
  blocked: { label: "Bloqué", tone: "red" },
  done: { label: "Terminé", tone: "green" },
  cancelled: { label: "Annulé", tone: "muted" },
};

export const ACTIVE_DEPLOYMENT_STATUSES: DeploymentStatus[] = ["planned", "preparing", "in_progress", "testing", "blocked"];

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_META: Record<Priority, { label: string; tone: Tone; weight: number }> = {
  low: { label: "Basse", tone: "muted", weight: 0 },
  medium: { label: "Moyenne", tone: "blue", weight: 1 },
  high: { label: "Haute", tone: "yellow", weight: 2 },
  critical: { label: "Critique", tone: "red", weight: 3 },
};

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: Tone }> = {
  todo: { label: "À faire", tone: "muted" },
  in_progress: { label: "En cours", tone: "accent" },
  done: { label: "Terminé", tone: "green" },
};

export const IP_STATUSES = ["used", "reserved", "dhcp", "free"] as const;
export type IpStatus = (typeof IP_STATUSES)[number];

export const IP_STATUS_META: Record<IpStatus, { label: string; tone: Tone }> = {
  used: { label: "Utilisée", tone: "accent" },
  reserved: { label: "Réservée", tone: "yellow" },
  dhcp: { label: "DHCP", tone: "blue" },
  free: { label: "Libre", tone: "muted" },
};

export const DISK_TYPES = ["nvme", "ssd", "hdd", "emmc", "virtual", "other"] as const;
export const DISK_TYPE_LABEL: Record<(typeof DISK_TYPES)[number], string> = {
  nvme: "NVMe",
  ssd: "SSD SATA",
  hdd: "HDD",
  emmc: "eMMC",
  virtual: "Disque virtuel",
  other: "Autre",
};

export const RAM_TYPES = ["", "DDR3", "DDR4", "DDR5", "LPDDR4", "LPDDR5", "DDR4 ECC", "DDR5 ECC"];

export const LINK_KINDS = ["ethernet", "fiber", "wifi", "vpn", "logical"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_META: Record<LinkKind, { label: string; tone: Tone; dashed: boolean }> = {
  ethernet: { label: "Ethernet", tone: "muted", dashed: false },
  fiber: { label: "Fibre / DAC", tone: "orange", dashed: false },
  wifi: { label: "Wi-Fi", tone: "blue", dashed: true },
  vpn: { label: "VPN", tone: "purple", dashed: true },
  logical: { label: "Logique", tone: "muted", dashed: true },
};

export const INTEGRATION_TYPES = ["proxmox", "beszel", "maintenant", "patchmon", "webmin", "hlm"] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const INTEGRATION_META: Record<
  IntegrationType,
  { label: string; description: string; icon: string; urlPlaceholder: string }
> = {
  proxmox: {
    label: "Proxmox VE",
    description: "Un nœud Proxmox autonome par intégration, agrégés sans cluster ni Datacenter Manager.",
    icon: "proxmox",
    urlPlaceholder: "https://192.168.1.10:8006",
  },
  beszel: {
    label: "Beszel",
    description: "Supervision légère des ressources système (CPU, RAM, disques, températures).",
    icon: "beszel",
    urlPlaceholder: "http://beszel.lan:8090",
  },
  maintenant: {
    label: "Maintenant",
    description: "Conteneurs, endpoints HTTP/TCP, heartbeats et certificats TLS.",
    icon: "maintenant",
    urlPlaceholder: "http://maintenant.lan:8080",
  },
  patchmon: {
    label: "PatchMon",
    description: "Suivi des mises à jour de paquets et des correctifs de sécurité Linux.",
    icon: "patchmon",
    urlPlaceholder: "https://patchmon.lan",
  },
  webmin: {
    label: "Webmin",
    description: "Toutes tes instances Webmin centralisées : état, système et mises à jour via SSH par clé.",
    icon: "webmin",
    urlPlaceholder: "https://192.168.1.20:10000",
  },
  hlm: {
    label: "Homelab Monitoring",
    description: "Ton hub de supervision : hôtes équipés de l'agent (Proxmox compris), sondes et mises à jour.",
    icon: "/icons/homelab-monitoring.svg",
    urlPlaceholder: "https://monitoring.lan",
  },
};

export const TONE_VAR: Record<Tone, string> = {
  accent: "var(--mm-accent)",
  green: "var(--mm-green)",
  yellow: "var(--mm-yellow)",
  red: "var(--mm-red)",
  blue: "var(--mm-blue)",
  purple: "var(--mm-purple)",
  cyan: "var(--mm-cyan)",
  orange: "var(--mm-orange)",
  pink: "var(--mm-pink)",
  muted: "var(--mm-muted)",
};

/** Variante texte (≥ 4.5:1) : remplissage vif pour les pastilles, -text pour les mots. */
export const TONE_TEXT_VAR = Object.fromEntries(
  Object.entries(TONE_VAR).map(([k, v]) => [k, k === "muted" ? v : v.replace(")", "-text)")]),
) as Record<Tone, string>;

export const VPN_TYPES = ["wireguard", "tailscale", "headscale", "netbird", "zerotier", "openvpn", "ipsec", "other"] as const;
export type VpnType = (typeof VPN_TYPES)[number];

export const VPN_TYPE_META: Record<VpnType, { label: string; icon: string; tone: Tone }> = {
  wireguard: { label: "WireGuard", icon: "wireguard", tone: "red" },
  tailscale: { label: "Tailscale", icon: "tailscale", tone: "blue" },
  headscale: { label: "Headscale", icon: "headscale", tone: "cyan" },
  netbird: { label: "NetBird", icon: "netbird", tone: "orange" },
  zerotier: { label: "ZeroTier", icon: "zerotier", tone: "yellow" },
  openvpn: { label: "OpenVPN", icon: "openvpn", tone: "orange" },
  ipsec: { label: "IPsec", icon: "", tone: "purple" },
  other: { label: "Autre", icon: "", tone: "muted" },
};

export const VPN_STATUSES = ["up", "down", "planned"] as const;
export type VpnStatus = (typeof VPN_STATUSES)[number];
export const VPN_STATUS_META: Record<VpnStatus, { label: string; tone: Tone }> = {
  up: { label: "Actif", tone: "green" },
  down: { label: "Coupé", tone: "red" },
  planned: { label: "Prévu", tone: "blue" },
};

export const FW_TARGETS = ["any", "vlan", "subnet", "asset", "cidr", "vpn", "internet"] as const;
export type FwTarget = (typeof FW_TARGETS)[number];
export const FW_TARGET_LABEL: Record<FwTarget, string> = {
  any: "N'importe où",
  vlan: "VLAN",
  subnet: "Sous-réseau",
  asset: "Élément",
  cidr: "Plage CIDR",
  vpn: "Tunnel VPN",
  internet: "Internet",
};

export const FW_PROTOCOLS = ["any", "tcp", "udp", "icmp"] as const;
export type FwProtocol = (typeof FW_PROTOCOLS)[number];
export const FW_PROTOCOL_LABEL: Record<FwProtocol, string> = { any: "Tous", tcp: "TCP", udp: "UDP", icmp: "ICMP (ping)" };
