import "server-only";
import { rememberHostKey, type Integration } from "../data/integrations";
import { getPrivateKey } from "../data/ssh-keys";
import { IntegrationError, probeUrl } from "./http";
import { sshExec } from "./ssh";

/** Instance Webmin : joignabilité de l'interface web + état système relevé par SSH (clé). */

export type WebminSystem = {
  hostname: string;
  os: string;
  kernel: string;
  uptime: number | null;
  load: [number, number, number] | null;
  cpus: number | null;
  memTotal: number | null;
  memUsed: number | null;
  diskTotal: number | null;
  diskUsed: number | null;
  webminVersion: string;
  webminService: string;
  updates: number | null;
  rebootRequired: boolean;
};

export type WebminInstance = {
  web: { up: boolean; status?: number; ms: number };
  ssh: boolean;
  system?: WebminSystem;
  sshError?: string;
};

// Lecture seule, POSIX sh : fonctionne sur Debian/Ubuntu, RHEL/Alma/Rocky, Alpine.
const SCRIPT = String.raw`
echo "hostname=$(hostname 2>/dev/null)"
[ -r /etc/os-release ] && . /etc/os-release && echo "os=$PRETTY_NAME"
echo "kernel=$(uname -r)"
echo "uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
echo "cpus=$(nproc 2>/dev/null)"
awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}END{if(t){print "mem_total="t*1024; print "mem_used="(t-a)*1024}}' /proc/meminfo 2>/dev/null
df -Pk / 2>/dev/null | awk 'NR==2{print "disk_total="$2*1024; print "disk_used="$3*1024}'
for f in /etc/webmin/version /usr/share/webmin/version /usr/libexec/webmin/version /opt/webmin/version; do
  [ -r "$f" ] && { echo "webmin_version=$(cat "$f")"; break; }
done
command -v systemctl >/dev/null 2>&1 && echo "webmin_service=$(systemctl is-active webmin 2>/dev/null)"
[ -f /var/run/reboot-required ] && echo "reboot=1"
if command -v apt-get >/dev/null 2>&1; then
  echo "updates=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c '^Inst ')"
elif command -v dnf >/dev/null 2>&1; then
  echo "updates=$(dnf -q --cacheonly check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')"
elif command -v apk >/dev/null 2>&1; then
  echo "updates=$(apk version -l '<' 2>/dev/null | tail -n +2 | wc -l)"
fi
`;

const num = (v?: string) => (v && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseSystem(stdout: string): WebminSystem {
  const kv: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const load = kv.load?.split(/\s+/).map(Number);
  return {
    hostname: kv.hostname ?? "",
    os: kv.os ?? "",
    kernel: kv.kernel ?? "",
    uptime: num(kv.uptime),
    load: load?.length === 3 && load.every(Number.isFinite) ? (load as [number, number, number]) : null,
    cpus: num(kv.cpus),
    memTotal: num(kv.mem_total),
    memUsed: num(kv.mem_used),
    diskTotal: num(kv.disk_total),
    diskUsed: num(kv.disk_used),
    webminVersion: kv.webmin_version ?? "",
    webminService: kv.webmin_service ?? "",
    updates: num(kv.updates),
    rebootRequired: kv.reboot === "1",
  };
}

async function readSystem(i: Integration): Promise<WebminSystem> {
  const { ssh_key_id, ssh_user, ssh_port, ssh_host_key } = i.config;
  if (!ssh_key_id || !ssh_user) throw new IntegrationError("SSH non configuré (clé + utilisateur)");
  const privateKey = getPrivateKey(ssh_key_id);
  if (!privateKey) throw new IntegrationError("Clé SSH introuvable (supprimée ?)");
  const { stdout, hostKey } = await sshExec(
    { host: new URL(i.url).hostname, port: ssh_port ?? 22, username: ssh_user, privateKey, hostKey: ssh_host_key },
    SCRIPT,
  );
  if (!ssh_host_key && i.id > 0) rememberHostKey(i.id, hostKey);
  return parseSystem(stdout);
}

export async function webminInstance(i: Integration): Promise<WebminInstance> {
  const ssh = !!(i.config.ssh_key_id && i.config.ssh_user);
  const [web, system] = await Promise.all([probeUrl(i.url), ssh ? readSystem(i).catch((e: Error) => e) : undefined]);
  return system instanceof Error ? { web, ssh, sshError: system.message } : { web, ssh, system };
}

export async function testWebmin(i: Integration) {
  const r = await webminInstance(i);
  if (!r.web.up && !r.system) throw new IntegrationError(r.sshError ?? "Interface Webmin injoignable");
  if (r.sshError) throw new IntegrationError(`Interface web ${r.web.up ? "joignable" : "injoignable"}, mais ${r.sshError}`);
  const web = r.web.up ? `interface joignable (${r.web.ms} ms)` : "interface web injoignable";
  return r.system
    ? `${r.system.hostname || "Hôte"} — Webmin ${r.system.webminVersion || "?"}, ${web}`
    : `Webmin : ${web} (SSH non configuré)`;
}
