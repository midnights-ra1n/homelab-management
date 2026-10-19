/* Sections shared by both interfaces (monitoring and management): database, server updates,
   passkeys and the journal. Same server endpoints on both roles, same components. */
import { useEffect, useState } from "react";
import { Bot, Database, Download, Fingerprint, KeyRound, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, ApiError, fmtBytes } from "../api";
import { Alert, Badge, Button, CodeBlock, EmptyState, Field, FORM_ACTIONS, inputClass, Meter, PageHeader, SettingsSection, Skeleton, Switch, useToast } from "../ui";

/* ---------- Database ---------- */

interface DbInfo {
  path: string; file_bytes: number; wal_bytes: number; used_bytes: number; limit_bytes: number; log_retention_days: number;
  tables: { name: string; rows: number; bytes: number }[]; disk_total_bytes?: number; disk_free_bytes?: number; uploads_bytes?: number;
}

export function DatabaseSection() {
  const [db, setDb] = useState<DbInfo>();
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const toast = useToast();
  const load = (d: DbInfo) => { setDb(d); setLimit(d.limit_bytes ? String(Math.round(d.limit_bytes / 1048576)) : ""); };
  useEffect(() => { api.get<DbInfo>("/api/database").then(load, (e) => setError(e.message)); }, []);
  if (!db) return error ? <Alert kind="error" title={error} /> : <Skeleton className="h-64" />;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(undefined);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(undefined); }
  };
  const diskUsed = db.disk_total_bytes && db.disk_free_bytes != null ? db.disk_total_bytes - db.disk_free_bytes : null;
  const tables = [...db.tables].sort((a, b) => b.bytes - a.bytes || b.rows - a.rows);

  return (
    <SettingsSection
      id="database"
      title="Base de données"
      description={`SQLite en mode WAL, cache réduit, écritures groupées. Le journal garde ${db.log_retention_days} jours. Une limite de taille supprime l'historique le plus ancien (métriques, résultats, journal) pour rester sous le plafond, sans toucher aux réglages ni à l'inventaire.`}
      actions={
        <>
          <Button variant="secondary" icon={<Trash2 size={15} />} loading={busy === "cleanup"}
            onClick={() => run("cleanup", async () => { load(await api.post<DbInfo>("/api/database/cleanup")); toast("Rétention appliquée"); })}>
            Nettoyer
          </Button>
          <Button variant="secondary" icon={<Database size={15} />} loading={busy === "vacuum"}
            onClick={() => run("vacuum", async () => { load(await api.post<DbInfo>("/api/database/vacuum")); toast("Base nettoyée et compactée"); })}>
            Compacter
          </Button>
        </>
      }
    >
      {error && <Alert kind="error" title={error} />}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        {[
          ["Fichier", fmtBytes(db.file_bytes)],
          ["Journal WAL", fmtBytes(db.wal_bytes)],
          ["Données", fmtBytes(db.used_bytes)],
          db.uploads_bytes != null ? ["Icônes", fmtBytes(db.uploads_bytes)] : ["Disque libre", fmtBytes(db.disk_free_bytes)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">{k}</dt>
            <dd className="mt-0.5 font-mono text-h2">{v}</dd>
          </div>
        ))}
      </dl>
      {diskUsed != null && db.disk_total_bytes ? (
        <Meter label="Disque du serveur" value={(diskUsed / db.disk_total_bytes) * 100}
          detail={`${fmtBytes(diskUsed)} / ${fmtBytes(db.disk_total_bytes)} · base : ${fmtBytes(db.file_bytes + db.wal_bytes)}`} />
      ) : null}
      {db.limit_bytes > 0 && <Meter label="Limite de la base" value={(db.used_bytes / db.limit_bytes) * 100} detail={`${fmtBytes(db.used_bytes)} / ${fmtBytes(db.limit_bytes)}`} />}
      <Field label="Taille maximale (Mo)" htmlFor="db-limit" hint="Vide ou 0 : pas de limite.">
        <div className="flex flex-wrap gap-3">
          <input id="db-limit" className={`${inputClass} max-w-40`} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} placeholder="0" />
          <Button variant="secondary" loading={busy === "limit"}
            onClick={() => run("limit", async () => {
              await api.put("/api/settings", { db_max_mb: limit === "" ? "0" : limit });
              load(await api.post<DbInfo>("/api/database/cleanup"));
              toast("Limite enregistrée");
            })}>
            Appliquer
          </Button>
        </div>
      </Field>
      <details className="text-sm">
        <summary className="text-accent-text">Taille par table</summary>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-meta"><tr><th className="py-1 font-medium">Table</th><th className="py-1 text-right font-medium">Lignes</th><th className="py-1 text-right font-medium">Taille</th></tr></thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.name} className="border-t border-line-subtle">
                <td className="py-1.5 font-mono text-h2">{t.name}</td>
                <td className="py-1.5 text-right font-mono">{t.rows.toLocaleString("fr-FR")}</td>
                <td className="py-1.5 text-right font-mono">{t.bytes ? fmtBytes(t.bytes) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 font-mono text-xs text-meta">{db.path}</p>
      </details>
    </SettingsSection>
  );
}

/* ---------- Server updates ---------- */

interface UpdateState { current: string; latest: string; available: boolean; install: string; checked_at: number; repo: string; pending?: string }

export function UpdateSection() {
  const [u, setU] = useState<UpdateState>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const toast = useToast();
  useEffect(() => { api.get<UpdateState>("/api/system/update").then(setU, (e) => setError(e.message)); }, []);
  // While an update is installing, the server restarts: poll until the new version answers.
  useEffect(() => {
    if (!u?.pending) return;
    const id = setInterval(() => {
      api.get<UpdateState>("/api/system/update").then((n) => { setU(n); if (n.current === u.pending) location.reload(); }, () => {});
    }, 5000);
    return () => clearInterval(id);
  }, [u?.pending]);
  if (!u) return error ? <Alert kind="error" title={error} /> : <Skeleton className="h-40" />;

  const run = async (key: string, path: string) => {
    setBusy(key);
    setError(undefined);
    try {
      const n = await api.post<UpdateState>(path);
      setU(n);
      if (key === "check") toast(n.available ? `Version ${n.latest} disponible` : "Le serveur est à jour");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Erreur réseau"); } finally { setBusy(undefined); }
  };
  const isDocker = u.install === "docker";
  const isDeb = u.install === "deb";

  return (
    <SettingsSection
      id="updates"
      title="Mises à jour du serveur"
      description={isDocker ? "Installé avec Docker : l'image se met à jour avec Docker (docker compose pull puis up -d)." : isDeb ? "Installé par paquet .deb : la mise à jour télécharge le paquet de la release GitHub, vérifie son empreinte SHA-256 et l'installe." : "Installation manuelle : remplacez le binaire par celui de la dernière release."}
      actions={
        <>
          <Button variant="secondary" icon={<RefreshCw size={15} />} loading={busy === "check"} onClick={() => run("check", "/api/system/update/check")}>
            Rechercher les mises à jour
          </Button>
          {isDeb && u.available && !u.pending && (
            <Button icon={<Download size={15} />} loading={busy === "apply"} onClick={() => run("apply", "/api/system/update")}>
              Mettre à jour vers {u.latest}
            </Button>
          )}
        </>
      }
    >
      {error && <Alert kind="error" title={error} />}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>Version installée <span className="font-mono text-h1">{u.current}</span></span>
        {u.latest ? (
          u.available ? <Badge tone="yellow">{u.latest} disponible</Badge> : <Badge tone="green">À jour</Badge>
        ) : <Badge tone="muted">Pas encore vérifié</Badge>}
        {u.checked_at > 0 && <span className="text-xs text-meta">vérifié le {new Date(u.checked_at * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>}
      </div>
      {u.pending && <Alert kind="info" title={`Installation de ${u.pending} en cours`}>Le service redémarre tout seul ; cette page se recharge quand la nouvelle version répond.</Alert>}
      {isDocker && u.available && <CodeBlock text="docker compose pull && docker compose up -d" />}
      <a className="text-sm text-accent-text" href={`https://github.com/${u.repo}/releases`} target="_blank" rel="noreferrer">Notes de version</a>
    </SettingsSection>
  );
}

/* ---------- MCP server ---------- */

interface McpState { enabled: boolean; token_set: boolean; https: boolean; url: string; tools: string[] }

/** MCP server for assistants (Claude…): read-only tools, HTTPS only, bearer token. */
export function McpSection() {
  const [st, setSt] = useState<McpState>();
  const [token, setToken] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const load = () => api.get<McpState>("/api/mcp/state").then(setSt, (e) => setError(e.message));
  useEffect(() => { load(); }, []);
  if (!st) return error ? <Alert kind="error" title={error} /> : <Skeleton className="h-40" />;

  const config = async (key: string, body: { enabled?: boolean; new_token?: boolean }) => {
    setBusy(key);
    setError(undefined);
    try {
      const r = await api.put<{ token?: string }>("/api/mcp/config", body);
      if (r.token) setToken(r.token);
      await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(undefined); }
  };
  const name = st.url.includes("://") ? new URL(st.url).hostname.split(".")[0] : "homelab";

  return (
    <SettingsSection
      id="mcp"
      title="Serveur MCP"
      description="Permet à un assistant compatible MCP (Claude…) d'interroger ce serveur en lecture seule : « est-ce que j'ai un service inaccessible ? ». Disponible uniquement en HTTPS, derrière un reverse proxy, avec un jeton."
      actions={
        <Button variant="secondary" icon={<KeyRound size={15} />} loading={busy === "token"} disabled={!st.https} onClick={() => config("token", { new_token: true })}>
          {st.token_set ? "Régénérer le jeton" : "Générer un jeton"}
        </Button>
      }
    >
      {error && <Alert kind="error" title={error} />}
      {!st.https && <Alert kind="warning" title="HTTPS requis">Ouvrez l'interface en HTTPS (reverse proxy avec certificat, HLT_TRUSTED_PROXIES renseigné) pour activer le serveur MCP. En HTTP, il refuse toutes les requêtes.</Alert>}
      <Switch checked={st.enabled} disabled={!st.https || busy === "enable"} onChange={(v) => config("enable", { enabled: v })}
        label="Activer le serveur MCP" hint={`Adresse : ${st.url}`} />
      {token && (
        <Alert kind="success" title="Jeton créé : copiez-le maintenant, il ne sera plus affiché">
          <CodeBlock text={token} />
        </Alert>
      )}
      {st.enabled && st.token_set && (
        <>
          <p className="text-sm text-body">Configuration d'un client MCP (ex. Claude Code : <code className="font-mono text-xs text-h2">claude mcp add --transport http {name} {st.url} --header "Authorization: Bearer …"</code>) :</p>
          <CodeBlock text={JSON.stringify({ mcpServers: { [name]: { type: "http", url: st.url, headers: { Authorization: `Bearer ${token ?? "mcp_…"}` } } } }, null, 2)} />
        </>
      )}
      <p className="flex flex-wrap items-center gap-2 text-xs text-meta"><Bot size={13} aria-hidden="true" /> Outils : {st.tools.map((t) => <code key={t} className="font-mono">{t}</code>)}</p>
    </SettingsSection>
  );
}

/* ---------- Passkeys ---------- */

type Passkey = { id: string; name: string; created_at: string; last_used_at: string | null };
const cancelled = (err: unknown) => err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
const passkeySupported = () => location.protocol === "https:" && typeof PublicKeyCredential?.parseRequestOptionsFromJSON === "function";
const sqlDate = (v: string) => new Date(v.replace(" ", "T") + "Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });

export function PasskeysSection() {
  const [list, setList] = useState<{ passkeys: Passkey[]; available: boolean }>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = () => api.get<{ passkeys: Passkey[]; available: boolean }>("/api/passkeys").then(setList, () => {});
  useEffect(() => { load(); }, []);

  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ session: string; options: PublicKeyCredentialCreationOptionsJSON }>("/api/passkeys/begin");
      const cred = (await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(r.options) })) as PublicKeyCredential | null;
      if (!cred) return;
      await api.post(`/api/passkeys?session=${encodeURIComponent(r.session)}&name=${encodeURIComponent(name)}`, cred.toJSON());
      setName("");
      toast("Passkey ajoutée");
      load();
    } catch (err) {
      if (err instanceof DOMException && err.name === "InvalidStateError") toast("Cet appareil a déjà une passkey pour ce compte.", "error");
      else if (!cancelled(err)) toast(err instanceof ApiError ? err.message : "Enregistrement de la passkey refusé.", "error");
    } finally { setBusy(false); }
  };

  return (
    <SettingsSection id="passkeys" title="Passkeys" description="Connexion sans mot de passe par biométrie, code de l'appareil ou clé de sécurité. Disponible uniquement en HTTPS (derrière un reverse proxy).">
      {list?.passkeys.length ? (
        <ul className="grid gap-2">
          {list.passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line-subtle bg-page px-4 py-3">
              <KeyRound size={16} className="shrink-0 text-meta" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-h1">{p.name}</span>
                <span className="block font-mono text-xs text-meta">Ajoutée le {sqlDate(p.created_at)} · {p.last_used_at ? `utilisée le ${sqlDate(p.last_used_at)}` : "jamais utilisée"}</span>
              </span>
              <Button variant="danger-ghost" size="sm" onClick={async () => {
                if (!confirm(`Supprimer la passkey « ${p.name} » ? Elle ne permettra plus de se connecter.`)) return;
                await api.del(`/api/passkeys/${encodeURIComponent(p.id)}`);
                load();
              }}>Supprimer</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {list?.available && passkeySupported() ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Nom" htmlFor="pk-name" className="flex-1">
            <input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="MacBook, iPhone, YubiKey…" className={inputClass} />
          </Field>
          <Button variant="secondary" icon={<Plus size={15} />} loading={busy} onClick={add}>Ajouter une passkey</Button>
        </div>
      ) : (
        <p className="text-xs text-meta">Ouvrez l'interface en HTTPS pour ajouter une passkey.</p>
      )}
    </SettingsSection>
  );
}

/** "Sign in with a passkey" under the password form (HTTPS only). */
export function PasskeyLoginButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!passkeySupported()) return null;
  const login = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.post<{ session: string; options: PublicKeyCredentialRequestOptionsJSON }>("/api/auth/passkey/begin");
      const cred = (await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(r.options) })) as PublicKeyCredential | null;
      if (!cred) return;
      await api.post(`/api/auth/passkey/finish?session=${encodeURIComponent(r.session)}`, cred.toJSON());
      location.reload();
    } catch (err) {
      if (!cancelled(err)) setError(err instanceof ApiError ? err.message : "Passkey non reconnue.");
    } finally { setBusy(false); }
  };
  return (
    <div className="mt-5 grid gap-4">
      <div className="flex items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
        <span className="h-px flex-1 bg-line-subtle" />ou<span className="h-px flex-1 bg-line-subtle" />
      </div>
      {error && <Alert kind="error" title={error} />}
      <Button variant="secondary" className="w-full" icon={<Fingerprint size={16} />} loading={busy} onClick={login}>
        Se connecter avec une passkey
      </Button>
    </div>
  );
}

/* ---------- Journal ---------- */

interface LogItem { id: number; entity_type: string; entity_id: number | null; action: string; summary: string; actor: string; created_at: string }
interface Logs { items: LogItem[]; entities: string[]; retention_days: number; more: boolean }

const ENTITY_LABEL: Record<string, string> = {
  account: "Compte", settings: "Paramètres", database: "Base de données", system: "Système", host: "Hôtes", monitor: "Sondes",
  token: "Jetons", device: "Appareils", report: "Rapports", status: "Page de statut", asset: "Inventaire", vlan: "VLAN", subnet: "Sous-réseaux",
  ip: "Adresses IP", vpn: "VPN", firewall: "Pare-feu", domain: "Domaines", deployment: "Déploiements", task: "Tâches",
  shortcut: "Applications", integration: "Intégrations", proxmox: "Proxmox",
};
const ACTION_TONE: Record<string, "green" | "red" | "yellow" | "blue" | "muted" | "accent"> = {
  create: "green", delete: "red", update: "blue", login: "accent", logout: "muted", decommission: "yellow", action: "yellow", cleanup: "muted", vacuum: "muted",
};

/** Journal page: everything done through the interface or the API, kept 90 days. */
export function LogsPage({ entityHref }: { entityHref?: (e: LogItem) => string | undefined }) {
  const [q, setQ] = useState("");
  const [entity, setEntity] = useState("");
  const [data, setData] = useState<Logs>();
  const [error, setError] = useState<string>();
  const query = (before?: number) => {
    const p = new URLSearchParams({ limit: "100" });
    if (q.trim()) p.set("q", q.trim());
    if (entity) p.set("entity", entity);
    if (before) p.set("before", String(before));
    return api.get<Logs>(`/api/logs?${p}`);
  };
  useEffect(() => {
    const t = setTimeout(() => query().then(setData, (e) => setError(e.message)), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, entity]);

  return (
    <>
      <PageHeader title="Journaux" description={`Tout ce qui a été fait depuis l'interface, l'API ou par les tâches automatiques, avec son auteur. Conservé ${data?.retention_days ?? 90} jours.`} />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Rechercher</span>
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-meta" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (texte, auteur)…" className={`${inputClass} w-full pl-9`} />
        </label>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className={`${inputClass} sm:w-56`} aria-label="Catégorie">
          <option value="">Toutes les catégories</option>
          {data?.entities.map((e) => <option key={e} value={e}>{ENTITY_LABEL[e] ?? e}</option>)}
        </select>
      </div>
      {error && <Alert kind="error" title={error} />}
      {!data ? <Skeleton className="h-96" /> : data.items.length === 0 ? (
        <EmptyState title="Aucune entrée">Rien n'a encore été journalisé avec ces filtres.</EmptyState>
      ) : (
        <>
          <ol className="divide-y divide-line-subtle overflow-hidden rounded-xl border border-line-subtle bg-box">
            {data.items.map((e) => {
              const href = entityHref?.(e);
              const date = new Date(e.created_at.replace(" ", "T") + "Z");
              return (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <time dateTime={date.toISOString()} className="shrink-0 font-mono text-xs text-meta sm:w-36">
                    {date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" })}
                  </time>
                  <span className="min-w-0 flex-1 text-sm text-h2">
                    {href ? <a href={href} className="hover:text-accent-text">{e.summary}</a> : e.summary}
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    <Badge tone={ACTION_TONE[e.action] ?? "muted"}>{ENTITY_LABEL[e.entity_type] ?? e.entity_type}</Badge>
                    <span className="max-w-48 truncate font-mono text-xs text-meta" title={e.actor}>{e.actor || "—"}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {data.more && (
            <div className={FORM_ACTIONS}>
              <Button variant="secondary" onClick={() => query(data.items.at(-1)!.id).then((n) => setData({ ...n, items: [...data.items, ...n.items] }))}>
                Plus ancien
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
