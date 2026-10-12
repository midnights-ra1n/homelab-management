/**
 * WAF applicatif, anti-force brute et bannissement temporaire d'IP.
 * Sans dépendance serveur (importé par le proxy et par les server actions) :
 * l'état vit dans globalThis, partagé par tout le processus.
 * shortcut: état en mémoire, remis à zéro au redémarrage ; passer en SQLite si plusieurs instances.
 */

type Counter = { count: number; until: number; last: number };
type Store = { bans: Map<string, number>; counters: Map<string, Counter> };

const store: Store = ((globalThis as { __hmSecurity?: Store }).__hmSecurity ??= {
  bans: new Map(),
  counters: new Map(),
});

const MAX_ENTRIES = 10_000;
const COUNTER_TTL = 60 * 60_000; // un compteur inactif depuis 1 h est oublié

/** Politiques : seuil avant blocage, durée initiale (doublée à chaque échec suivant), plafond. */
export const POLICIES = {
  // Réglages homelab : tolérants aux fautes de frappe et faux positifs, bannissements courts.
  user: { threshold: 10, base: 15, max: 5 * 60 },
  ip: { threshold: 25, base: 30, max: 10 * 60 },
  waf: { threshold: 15, base: 60, max: 30 * 60 },
} as const;
type Policy = keyof typeof POLICIES;

function prune(now: number) {
  if (store.bans.size + store.counters.size < MAX_ENTRIES) return;
  for (const [k, until] of store.bans) if (until <= now) store.bans.delete(k);
  for (const [k, c] of store.counters) if (c.until <= now && now - c.last > COUNTER_TTL) store.counters.delete(k);
  // Encore plein (attaque distribuée) : on vide les compteurs, jamais les bannissements actifs.
  if (store.bans.size + store.counters.size >= MAX_ENTRIES) store.counters.clear();
}

/**
 * IP du client : dernière entrée de X-Forwarded-For (ajoutée par le reverse proxy,
 * ou par Next.js depuis le socket). Exposée sans proxy, elle est falsifiable : le
 * verrou par identifiant reste alors la vraie protection contre la force brute.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const ip = xff?.split(",").pop()?.trim() || headers.get("x-real-ip")?.trim() || "unknown";
  return ip.replace(/^::ffff:/, "").slice(0, 64);
}

/** Secondes restantes de bannissement de l'IP (0 = libre). */
export function banRemaining(ip: string, now = Date.now()): number {
  const until = store.bans.get(ip);
  if (!until) return 0;
  if (until <= now) {
    store.bans.delete(ip);
    return 0;
  }
  return Math.ceil((until - now) / 1000);
}

/** Secondes restantes de verrouillage pour une clé (ex. « user:admin »). */
export function lockRemaining(key: string, now = Date.now()): number {
  const c = store.counters.get(key);
  return c && c.until > now ? Math.ceil((c.until - now) / 1000) : 0;
}

/**
 * Enregistre un échec. Au-delà du seuil, verrouille la clé avec une durée
 * exponentielle ; renvoie la durée du verrou en secondes (0 si pas encore).
 */
export function recordFailure(policy: Policy, key: string, now = Date.now()): number {
  prune(now);
  const p = POLICIES[policy];
  const id = `${policy}:${key}`;
  const prev = store.counters.get(id);
  const count = prev && now - prev.last < COUNTER_TTL ? prev.count + 1 : 1;
  const seconds = count >= p.threshold ? Math.min(p.max, p.base * 2 ** (count - p.threshold)) : 0;
  store.counters.set(id, { count, last: now, until: seconds ? now + seconds * 1000 : 0 });
  // Une IP verrouillée (login répété ou WAF) est bannie de toute l'application.
  if (seconds && policy !== "user") store.bans.set(key, Math.max(store.bans.get(key) ?? 0, now + seconds * 1000));
  return seconds;
}

export function clearFailures(policy: Policy, key: string) {
  store.counters.delete(`${policy}:${key}`);
}

/* ----------------------------------------------------------------------------
 * WAF : signatures d'attaques connues sur l'URL et le User-Agent.
 * Le corps des requêtes n'est pas inspecté (notes, compose… contiennent
 * légitimement du code) : il est protégé par les requêtes SQL paramétrées,
 * la validation zod et l'échappement React.
 * -------------------------------------------------------------------------- */

const RULES: [string, RegExp][] = [
  ["traversal", /(?:\.\.[/\\]|[/\\]\.\.(?:$|[/\\])|\/etc\/(?:passwd|shadow)|\/proc\/self|\0|win\.ini|boot\.ini)/i],
  ["sqli", /(?:\bunion\b[\s\S]{0,40}\bselect\b|\bselect\b[\s\S]{0,60}\bfrom\b[\s\S]{0,60}\b(?:information_schema|sqlite_master|pg_catalog|mysql\.)|\b(?:sleep|benchmark|pg_sleep|load_file|randomblob)\s*\(|\bwaitfor\s+delay\b|['"]\s*(?:or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+|['"`]\s*;\s*(?:drop|delete|insert|update|alter|attach)\b|\bxp_cmdshell\b)/i],
  ["xss", /(?:<\s*\/?\s*(?:script|iframe|object|embed|svg|math|base|meta|link|style)\b|\bjavascript\s*:|\bvbscript\s*:|\bdata\s*:\s*text\/html|\bon[a-z]{3,20}\s*=|\bsrcdoc\s*=|expression\s*\()/i],
  ["injection", /(?:\$\{jndi:|\$\{[^}]*(?:env|sys|java):|<%|%>|\{\{.*\}\}|<\?php|;\s*(?:cat|wget|curl|bash|sh|nc)\s|\|\s*(?:cat|wget|curl|bash|sh|nc)\s|`[^`]*`|\$\((?:[^)]*)\))/i],
  ["crlf", /[\r\n]/],
  ["scanner", /(?:^|\/)(?:\.env|\.git|\.svn|\.hg|\.ds_store|\.htaccess|\.htpasswd|wp-admin|wp-login|wp-content|wp-includes|xmlrpc|phpmyadmin|pma|adminer|cgi-bin|actuator|server-status|vendor\/phpunit|boaform|hnap1|owa|autodiscover)\b|\.(?:php\d?|asp|aspx|jsp|cgi|pl|bak|sql|old|swp|ini|conf|cfg|log)$/i],
];

const BAD_AGENTS =
  /(?:sqlmap|nikto|nmap|masscan|nuclei|acunetix|wpscan|zgrab|dirbuster|gobuster|feroxbuster|ffuf|wfuzz|hydra|medusa|havij|w3af|openvas|nessus|netsparker|jaeles|commix|xsstrike|arachni|skipfish|whatweb|joomscan|httpx-toolkit|zmeu|morfeus)/i;

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "OPTIONS"]);

function decode(value: string): string {
  // Double décodage : déjoue « %252e%252e » et consorts.
  let out = value;
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(out.replace(/\+/g, " "));
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

/** Renvoie la règle déclenchée, ou null si la requête est saine. */
export function wafInspect(req: { method: string; url: string; headers: Headers }): string | null {
  if (!ALLOWED_METHODS.has(req.method.toUpperCase())) return "method";
  const ua = req.headers.get("user-agent") ?? "";
  if (BAD_AGENTS.test(ua)) return "scanner-agent";
  const url = new URL(req.url);
  if (url.pathname.length + url.search.length > 4096) return "oversize";
  const path = decode(url.pathname);
  const query = decode(url.search.slice(1));
  // Cookies et Referer ne sont pas inspectés : partagés avec les autres apps du homelab, trop de faux positifs.
  for (const [name, re] of RULES) {
    if (re.test(path)) return name;
    if (name !== "scanner" && re.test(query)) return name;
  }
  return null;
}
