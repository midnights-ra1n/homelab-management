import { z } from "zod";
import {
  ASSET_KINDS,
  ASSET_STATUSES,
  DEPLOYMENT_KINDS,
  DEPLOYMENT_STATUSES,
  DISK_TYPES,
  INTEGRATION_TYPES,
  IP_STATUSES,
  LINK_KINDS,
  PRIORITIES,
  TASK_STATUSES,
  TONES,
  VPN_STATUSES,
  VPN_TYPES,
  FW_TARGETS,
  FW_PROTOCOLS,
} from "./constants";
import { isIpv4, isValidPortSpec, normalizeCidr } from "./ip";

/* ----------------------------------------------------------------------------
 * Briques : les FormData arrivent en chaînes, les champs vides deviennent null.
 * -------------------------------------------------------------------------- */

const blankToNull = (v: unknown) => (v === "" || v === undefined || v === null ? null : v);

export const text = (max = 500) =>
  z.preprocess((v) => (v == null ? "" : String(v)), z.string().trim().max(max, `${max} caractères maximum`));

export const required = (label: string, max = 200) =>
  z.preprocess(
    (v) => (v == null ? "" : String(v)),
    z.string().trim().min(1, `${label} est requis`).max(max, `${max} caractères maximum`),
  );

const optNumber = (opts: { int?: boolean; min?: number; max?: number } = {}) =>
  z.preprocess(
    (v) => {
      const b = blankToNull(v);
      return b === null ? null : Number(String(b).replace(",", "."));
    },
    (() => {
      let n = z.number({ error: "Nombre invalide" });
      if (opts.int) n = n.int("Nombre entier attendu");
      if (opts.min !== undefined) n = n.min(opts.min, `Minimum ${opts.min}`);
      if (opts.max !== undefined) n = n.max(opts.max, `Maximum ${opts.max}`);
      return n.nullable();
    })(),
  );

const optId = z.preprocess((v) => {
  const b = blankToNull(v);
  return b === null ? null : Number(b);
}, z.number().int().positive().nullable());

const optDate = z.preprocess(blankToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide").nullable());

const checkbox = z.preprocess((v) => v === "on" || v === "true" || v === "1" || v === true, z.boolean());

const optIp = z.preprocess(
  (v) => (v == null ? "" : String(v).trim()),
  z.string().refine((v) => v === "" || isIpv4(v), "Adresse IPv4 invalide"),
);

const mac = z.preprocess(
  (v) => (v == null ? "" : String(v).trim().toLowerCase().replace(/-/g, ":")),
  z.string().refine((v) => v === "" || /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(v), "Adresse MAC invalide"),
);

const url = z.preprocess(
  (v) => (v == null ? "" : String(v).trim()),
  z.string().refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "URL http(s) invalide"),
);

/** "web, prod , dns" → ["web","prod","dns"] (dédoublonné, minuscules). */
export const tags = z.preprocess(
  (v) =>
    String(v ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  z.array(z.string().max(40)).max(30).transform((a) => [...new Set(a)]),
);

const jsonArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => {
    if (v == null || v === "") return [];
    try {
      return JSON.parse(String(v));
    } catch {
      return [];
    }
  }, z.array(item).max(64));

/* ----------------------------------------------------------------------------
 * Inventaire
 * -------------------------------------------------------------------------- */

export const diskSchema = z.object({
  name: z.string().trim().max(80).default(""),
  type: z.enum(DISK_TYPES).default("ssd"),
  capacity_gb: z.coerce.number().min(0).max(10_000_000).nullable().default(null),
  usage: z.string().trim().max(120).default(""),
});

export const nicSchema = z.object({
  name: z.string().trim().max(40).default(""),
  mac: z.string().trim().max(17).default(""),
  speed: z.string().trim().max(20).default(""),
});

export const assetSchema = z.object({
  kind: z.enum(ASSET_KINDS),
  display_name: required("Le nom d'affichage", 120),
  hostname: z.preprocess(
    (v) => (v == null ? "" : String(v).trim().toLowerCase()),
    z.string().max(253).regex(/^[a-z0-9.-]*$/, "Nom d'hôte invalide (a-z, 0-9, « - » et « . »)"),
  ),
  status: z.enum(ASSET_STATUSES),
  role: text(120),
  description: text(2000),
  tags,
  parent_id: optId,
  os: text(80),
  os_version: text(80),
  location: text(120),
  manufacturer: text(80),
  model: text(120),
  serial_number: text(120),
  cpu_model: text(160),
  cpu_sockets: optNumber({ int: true, min: 1, max: 16 }),
  cpu_cores: optNumber({ int: true, min: 1, max: 4096 }),
  cpu_threads: optNumber({ int: true, min: 1, max: 8192 }),
  ram_gb: optNumber({ min: 0, max: 65536 }),
  ram_type: text(40),
  gpu: text(160),
  disks: jsonArray(diskSchema),
  nics: jsonArray(nicSchema),
  power_watts: optNumber({ int: true, min: 0, max: 100000 }),
  management_url: url,
  docker_image: text(255),
  docker_ports: text(500),
  docker_compose: text(255),
  proxmox_integration_id: optId,
  proxmox_node: text(80),
  proxmox_vmid: optNumber({ int: true, min: 100, max: 999999999 }),
  notes: text(10000),
  // Réseau principal
  primary_ip: optIp,
  primary_subnet_id: optId,
  primary_mac: mac,
});
export type AssetInput = z.infer<typeof assetSchema>;

/* ----------------------------------------------------------------------------
 * Réseau
 * -------------------------------------------------------------------------- */

export const vlanSchema = z.object({
  vlan_id: optNumber({ int: true, min: 1, max: 4094 }).refine((v) => v !== null, "Le VLAN ID est requis"),
  name: required("Le nom", 80),
  description: text(500),
  color: z.enum(TONES).default("accent"),
});
export type VlanInput = z.infer<typeof vlanSchema>;

export const subnetSchema = z.object({
  name: required("Le nom", 80),
  cidr: z.preprocess(
    (v) => String(v ?? "").trim(),
    z
      .string()
      .min(1, "Le CIDR est requis")
      .refine((v) => normalizeCidr(v) !== null, "CIDR invalide (ex. 192.168.10.0/24, préfixe /8 à /32)")
      .transform((v) => normalizeCidr(v)!),
  ),
  vlan_id: optId,
  gateway: optIp,
  dns: text(200),
  dhcp_start: optIp,
  dhcp_end: optIp,
  description: text(500),
});
export type SubnetInput = z.infer<typeof subnetSchema>;

export const ipSchema = z.object({
  address: z.preprocess((v) => String(v ?? "").trim(), z.string().refine(isIpv4, "Adresse IPv4 invalide")),
  subnet_id: optId,
  asset_id: optId,
  mac,
  hostname: text(253),
  status: z.enum(IP_STATUSES),
  description: text(500),
});
export type IpInput = z.infer<typeof ipSchema>;

/* ----------------------------------------------------------------------------
 * Déploiements & tâches
 * -------------------------------------------------------------------------- */

export const deploymentSchema = z.object({
  title: required("Le titre", 160),
  kind: z.enum(DEPLOYMENT_KINDS),
  status: z.enum(DEPLOYMENT_STATUSES),
  priority: z.enum(PRIORITIES),
  description: text(5000),
  target_host_id: optId,
  asset_id: optId,
  planned_cpu: optNumber({ int: true, min: 1, max: 1024 }),
  planned_ram_gb: optNumber({ min: 0, max: 65536 }),
  planned_disk_gb: optNumber({ min: 0, max: 10_000_000 }),
  planned_ip: optIp,
  subnet_id: optId,
  target_date: optDate,
  notes: text(10000),
  tags,
  vmid: optNumber({ int: true, min: 1, max: 999999999 }),
  apps: text(2000),
  local_fqdn: text(253),
  public_fqdn: text(253),
  steps: jsonArray(z.object({ label: z.string().trim().min(1).max(300), done: z.boolean().default(false) })),
});
export type DeploymentInput = z.infer<typeof deploymentSchema>;

export const taskSchema = z.object({
  title: required("Le titre", 200),
  description: text(5000),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  due_date: optDate,
  tags,
  asset_id: optId,
  deployment_id: optId,
});
export type TaskInput = z.infer<typeof taskSchema>;

/* ----------------------------------------------------------------------------
 * Page d'accueil
 * -------------------------------------------------------------------------- */

export const shortcutSchema = z.object({
  name: required("Le nom", 80),
  url: z.preprocess(
    (v) => String(v ?? "").trim(),
    z.string().min(1, "L'URL est requise").regex(/^https?:\/\/\S+$/i, "URL http(s) invalide"),
  ),
  description: text(200),
  group_id: optId,
  icon_type: z.enum(["none", "dashboard", "selfhst", "upload", "url"]),
  icon_value: text(500),
  asset_id: optId,
  new_tab: checkbox,
  status_check: checkbox,
});
export type ShortcutInput = z.infer<typeof shortcutSchema>;

export const sshKeySchema = z.object({
  name: z.preprocess(
    (v) => (v == null ? "" : String(v).trim()),
    z.string().min(1, "Le nom est requis").max(60).regex(/^[\w .@-]+$/, "Lettres, chiffres, espace, « . @ - _ » uniquement"),
  ),
  mode: z.enum(["ed25519", "rsa", "import"]),
  private_key: text(20000),
});

export const groupSchema = z.object({ name: required("Le nom", 60) });

/* ----------------------------------------------------------------------------
 * Intégrations
 * -------------------------------------------------------------------------- */

export const integrationSchema = z.object({
  type: z.enum(INTEGRATION_TYPES),
  name: required("Le nom", 80),
  url: z.preprocess(
    (v) => String(v ?? "").trim().replace(/\/+$/, ""),
    z.string().min(1, "L'URL est requise").regex(/^https?:\/\/\S+$/i, "URL http(s) invalide"),
  ),
  enabled: checkbox,
  // Champs de configuration (selon le type) — les secrets vides conservent la valeur existante
  username: text(200),
  password: text(500),
  token_id: text(200),
  token_secret: text(500),
  auth_header: text(1000),
  verify_tls: checkbox,
  ssh_key_id: optId,
  ssh_user: z.preprocess(
    (v) => (v == null ? "" : String(v).trim()),
    z.string().max(32).regex(/^([a-z_][a-z0-9_.-]*)?$/i, "Nom d'utilisateur SSH invalide"),
  ),
  ssh_port: optNumber({ int: true, min: 1, max: 65535 }),
  reset_host_key: checkbox,
});
export type IntegrationInput = z.infer<typeof integrationSchema>;

export const linkSchema = z.object({
  source_id: optId.refine((v) => v !== null, "Source requise"),
  target_id: optId.refine((v) => v !== null, "Cible requise"),
  kind: z.enum(LINK_KINDS),
  label: text(60),
});

/* ----------------------------------------------------------------------------
 * VPN & pare-feu
 * -------------------------------------------------------------------------- */

const optCidr = z.preprocess(
  (v) => String(v ?? "").trim(),
  z
    .string()
    .refine((v) => v === "" || normalizeCidr(v) !== null, "CIDR invalide (ex. 10.8.0.0/24)")
    .transform((v) => (v ? normalizeCidr(v)! : "")),
);

/** « 192.168.10.0/24, 10.0.0.0/8 » → liste de CIDR normalisés. */
const cidrList = z.preprocess(
  (v) =>
    String(v ?? "")
      .split(/[\s,;]+/)
      .map((c) => c.trim())
      .filter(Boolean),
  z
    .array(z.string())
    .max(64)
    .refine((list) => list.every((c) => normalizeCidr(c) !== null), "Une des routes n'est pas un CIDR valide")
    .transform((list) => [...new Set(list.map((c) => normalizeCidr(c)!))]),
);

export const vpnSchema = z.object({
  name: required("Le nom", 80),
  type: z.enum(VPN_TYPES),
  status: z.enum(VPN_STATUSES),
  endpoint_a_id: optId,
  endpoint_b_id: optId,
  endpoint_b_label: text(80),
  tunnel_cidr: optCidr,
  ip_a: optIp,
  ip_b: optIp,
  routes_a: cidrList,
  routes_b: cidrList,
  listen_port: optNumber({ int: true, min: 1, max: 65535 }),
  public_endpoint: text(200),
  notes: text(2000),
});
export type VpnInput = z.infer<typeof vpnSchema>;

export const ruleSchema = z.object({
  name: text(80),
  enabled: checkbox,
  action: z.enum(["allow", "deny"]),
  src_type: z.enum(FW_TARGETS),
  src_value: text(80),
  dst_type: z.enum(FW_TARGETS),
  dst_value: text(80),
  protocol: z.enum(FW_PROTOCOLS),
  ports: z.preprocess(
    (v) => String(v ?? "").replace(/\s+/g, ""),
    z.string().max(200).refine(isValidPortSpec, "Ports invalides (ex. 22,80,443,8000-8100)"),
  ),
  notes: text(500),
});
export type RuleInput = z.infer<typeof ruleSchema>;

export const monitorSchema = z
  .object({
    name: required("Le nom", 80),
    type: z.enum(["http", "tcp"]),
    target: required("La cible", 500),
    interval_sec: optNumber({ int: true, min: 15, max: 3600 }).transform((v) => v ?? 60),
    timeout_ms: optNumber({ int: true, min: 500, max: 30000 }).transform((v) => v ?? 5000),
    accept: z.enum(["2xx3xx", "lt500"]),
    verify_tls: checkbox,
    enabled: checkbox,
    asset_id: optId,
  })
  .superRefine((m, ctx) => {
    if (m.type === "http" && !/^https?:\/\/\S+$/i.test(m.target)) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "URL http(s) attendue" });
    }
    if (m.type === "tcp" && !/^[a-z0-9.-]+:\d{1,5}$/i.test(m.target)) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "Format hôte:port attendu (ex. 192.168.10.2:22)" });
    }
  });
export type MonitorInput = z.infer<typeof monitorSchema>;

/* ----------------------------------------------------------------------------
 * Résultat d'action de formulaire
 * -------------------------------------------------------------------------- */

export type FormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Incrémenté à chaque succès pour fermer les dialogues côté client. */
  nonce?: number;
};

export function zodErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    out[key] ??= issue.message;
  }
  return out;
}

export function formObject(fd: FormData): Record<string, FormDataEntryValue> {
  const obj: Record<string, FormDataEntryValue> = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith("$ACTION")) obj[k] = v;
  return obj;
}
