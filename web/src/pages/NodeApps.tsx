import { createContext, useContext, useEffect, useState } from "react";
import { Download, ExternalLink, Eye, GitPullRequestArrow, KeyRound, LoaderCircle, Package, Plus, RotateCw, Square, Trash2, Upload } from "../shared/icons";
import { actionBusy, api, ApiError, fmtAgo, fmtDate, type Host, type NodeAction, type NodeApp, type NodeOp } from "../api";
import {
  Alert, Badge, Button, ButtonAnchor, Card, Checkbox, CodeBlock, Dialog, Field, FIELD_ROW, Segmented, Skeleton, StatusIcon, cn,
  inputClass, textareaClass, type StatusKind, type Tone, usePoll, useToast,
} from "../ui";
import { useHostAction } from "./AgentVersion";
import { EnvVars } from "./EnvVars";
import { GitHook, PauseEditor } from "./NodePause";

/** Base of a host's Node.js routes: the monitoring's own, or the management's relay to it (mg_nodeapps.go). */
const NodeBase = createContext<string | undefined>(undefined);
const useBase = (h: Host) => useContext(NodeBase) ?? `/api/hosts/${h.id}`;

export const STATUS: Record<string, [string, Tone]> = {
  online: ["En ligne", "green"], stopped: ["Arrêtée", "muted"], errored: ["En erreur", "red"],
  launching: ["Démarre", "yellow"], stopping: ["S'arrête", "yellow"], paused: ["En pause", "yellow"],
};
const RESULT: Record<string, [string, Tone]> = {
  running: ["En cours", "blue"], success: ["Réussi", "green"], failed: ["Échec", "red"],
  rolled_back: ["Retour arrière", "yellow"], interrupted: ["Interrompu", "muted"],
};
const KIND: Record<string, string> = { deploy: "Déploiement", "auto-deploy": "Déploiement auto", update: "Mise à jour des dépendances" };
const ACTIONS: { action: NodeAction; label: string; hint: string; icon: React.ReactNode }[] = [
  { action: "node_deploy", label: "Déployer", hint: "Réinstalle, rebuild et redémarre, même sans nouveau commit", icon: <Download size={14} /> },
  { action: "node_pull", label: "Nouveaux commits", hint: "Déploie seulement si le dépôt a un nouveau commit", icon: <GitPullRequestArrow size={14} /> },
  { action: "node_update", label: "Mettre à jour", hint: "pnpm update et rebuild, retour arrière en cas d'échec", icon: <Package size={14} /> },
  { action: "node_restart", label: "Redémarrer", hint: "Redémarre l'app (PM2)", icon: <RotateCw size={14} /> },
  { action: "node_stop", label: "Arrêter", hint: "Arrête l'app (PM2)", icon: <Square size={14} /> },
];

// node-app-ui shows a "running" operation older than an hour as interrupted (server restarted).
const opResult = (o: NodeOp) => (o.result === "running" && Date.now() / 1000 - o.started > 3600 ? "interrupted" : o.result);
const short = (c: string) => (c && c !== "local" ? c.slice(0, 7) : c);
const noAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
const appKind = (a: NodeApp): StatusKind =>
  a.status === "errored" ? "down" : a.status === "online" ? (a.failed_commit ? "warn" : "ok") : a.status === "stopped" || a.status === "paused" ? "paused" : "warn";

/** Address of the host for the node-app-ui link: first IPv4 that is not loopback or a bridge (as hostAddress in Go). */
const hostAddress = (h: Host) =>
  h.info.ips?.find((i) => !i.address.includes(":") && !i.address.startsWith("127.") && !/^(lo|docker|br-|veth|virbr)/.test(i.iface))?.address ?? h.info.hostname;

/** node-app-ui of the host, "" when it has none. */
export const nodeUiUrl = (h: Host) => (h.node_apps?.ui_port ? `https://${hostAddress(h)}:${h.node_apps.ui_port}` : "");

function ResultBadge({ o }: { o: NodeOp }) {
  const [label, tone] = RESULT[opResult(o)] ?? [o.result, "muted" as Tone];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/** Log of one operation, followed while it runs (like node-app-ui: read from an offset every 1.5 s). */
function OpLog({ h, app, op }: { h: Host; app: string; op: string }) {
  const base = useBase(h);
  const [text, setText] = useState("");
  const [state, setState] = useState<{ running: boolean; error?: string }>({ running: true });
  useEffect(() => {
    let offset = 0, stop = false, timer = 0;
    setText("");
    setState({ running: true });
    const step = async () => {
      try {
        const r = await api.get<{ text: string; offset: number; operation: NodeOp | null }>(`${base}/node-apps/${app}/operations/${op}?offset=${offset}`);
        if (stop) return;
        offset = r.offset;
        setText((t) => t + noAnsi(r.text));
        const running = !!r.operation && opResult(r.operation) === "running";
        setState({ running });
        if (running) timer = window.setTimeout(step, 1500);
      } catch (e) {
        if (!stop) setState({ running: false, error: (e as Error).message });
      }
    };
    step();
    return () => { stop = true; clearTimeout(timer); };
  }, [h.id, app, op]);
  return (
    <div className="grid gap-2">
      {state.error && <Alert kind="error" title="Lecture du journal impossible">{state.error}</Alert>}
      <pre className="max-h-96 overflow-auto rounded-xl border border-line bg-field p-3 font-mono text-xs whitespace-pre-wrap text-h2" aria-live="polite">
        {text || (state.running ? "…" : "Journal vide.")}
      </pre>
      {state.running && <span className="inline-flex items-center gap-1.5 text-xs text-meta"><LoaderCircle size={12} className="animate-spin" aria-hidden />Suivi en direct</span>}
    </div>
  );
}

/** PM2 logs of the app, refreshed every 4 s while shown. */
function AppLogs({ h, app }: { h: Host; app: string }) {
  const base = useBase(h);
  const [lines, setLines] = useState<"100" | "500" | "2000">("100");
  const { data, error } = usePoll(() => api.get<{ text: string }>(`${base}/node-apps/${app}/logs?lines=${lines}`), 4000, [h.id, app, lines]);
  return (
    <div className="grid gap-3">
      <Segmented size="sm" label="Lignes" value={lines} onChange={setLines} options={[["100", "100 lignes"], ["500", "500"], ["2000", "2000"]]} />
      {error && <Alert kind="error" title="Lecture des logs impossible">{error}</Alert>}
      {!data && !error ? <Skeleton className="h-64" /> : data && (
        <pre className="max-h-[28rem] overflow-auto rounded-xl border border-line bg-field p-3 font-mono text-xs whitespace-pre-wrap text-h2">{noAnsi(data.text) || "Aucun log."}</pre>
      )}
    </div>
  );
}

/** Why the secret-bearing requests (variables, keys, creation) are unavailable, if they are. */
const writeBlock = (h: Host) => (!h.connected ? "Agent hors ligne" : !h.node_apps?.actions ? "Hôte en lecture seule (NODE_APPS_ACTIONS=0)" : undefined);
const isSshRepo = (url: string) => /^(ssh:\/\/|[A-Za-z0-9._-]+@[^/:]+:)/.test(url.trim());

/** The app's variables (.env), like node-app-ui: loaded on demand, saved with a restart of the app. */
function EnvEditor({ h, app }: { h: Host; app: string }) {
  const base = useBase(h);
  const toast = useToast();
  const [text, setText] = useState<string>();
  const [draft, setDraft] = useState({ text: "", invalid: false });
  const [saved, setSaved] = useState<string>(); // the blocks' text when loaded or last saved
  const [busy, setBusy] = useState<"load" | "save">();
  const [error, setError] = useState<string>();
  const blocked = writeBlock(h);
  const load = async () => {
    setBusy("load"); setError(undefined);
    try { setText((await api.get<{ text: string }>(`${base}/node-apps/${app}/env`)).text); } catch (e) { setError((e as Error).message); }
    setBusy(undefined);
  };
  const save = async () => {
    setBusy("save");
    try {
      await api.put(`${base}/node-apps/${app}/env`, { text: draft.text });
      setSaved(draft.text);
      toast("Variables enregistrées, application redémarrée", "success");
    } catch (e) { toast((e as Error).message, "error"); }
    setBusy(undefined);
  };
  if (text === undefined) {
    return (
      <div className="grid justify-items-start gap-3">
        <p className="text-sm text-meta">Les variables ne sont jamais conservées par le monitoring : elles sont lues sur l'hôte à la demande.</p>
        {error && <Alert kind="error" title="Lecture impossible">{error}</Alert>}
        <Button variant="secondary" size="sm" icon={<Eye size={14} />} loading={busy === "load"} disabled={!!blocked} title={blocked} onClick={load}>Afficher les variables</Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <EnvVars initial={text} onChange={(t, invalid) => { setDraft({ text: t, invalid }); setSaved((s) => s ?? t); }} />
      <p className="mm-help">L'app redémarre après l'enregistrement.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => { setText(undefined); setSaved(undefined); }}>Masquer</Button>
        <Button size="sm" loading={busy === "save"} disabled={!!blocked || draft.invalid || draft.text === saved} title={blocked ?? (draft.invalid ? "Variables à corriger" : undefined)} onClick={save}>Enregistrer et redémarrer</Button>
      </div>
    </div>
  );
}

/** Deploy key of an app: replace it by a new one, or import an existing private key. */
function KeyActions({ h, app, onChanged }: { h: Host; app: string; onChanged?: () => void }) {
  const base = useBase(h);
  const toast = useToast();
  const [dialog, setDialog] = useState<"new" | "import">();
  const [priv, setPriv] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = writeBlock(h);
  const send = async (body: object) => {
    setBusy(true);
    try {
      await api.post(`${base}/node-apps/${app}/key`, body);
      toast("Deploy key remplacée : ajoutez-la au dépôt", "success");
      setDialog(undefined); setPriv(""); onChanged?.();
    } catch (e) { toast((e as Error).message, "error"); }
    setBusy(false);
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<KeyRound size={14} />} disabled={!!blocked} title={blocked} onClick={() => setDialog("new")}>Nouvelle clé</Button>
        <Button variant="secondary" size="sm" icon={<Upload size={14} />} disabled={!!blocked} title={blocked} onClick={() => setDialog("import")}>Importer une clé</Button>
      </div>
      <Dialog open={!!dialog} onClose={() => setDialog(undefined)} size="sm" title={dialog === "new" ? "Nouvelle deploy key" : "Importer une clé SSH"}
        description={dialog === "new" ? "L'ancienne clé est supprimée de l'hôte : ajoutez la nouvelle au dépôt avant le prochain déploiement." : "Clé privée existante (clé de compte, autre serveur), sans phrase de passe. Elle remplace la deploy key de l'app."}
        footer={<><Button variant="secondary" onClick={() => setDialog(undefined)}>Annuler</Button>
          {dialog === "new"
            ? <Button icon={<KeyRound size={16} />} loading={busy} onClick={() => send({ regenerate: true })}>Remplacer la clé</Button>
            : <Button icon={<Upload size={16} />} loading={busy} disabled={!priv.trim()} onClick={() => send({ private_key: priv })}>Importer</Button>}</>}>
        {dialog === "import" && (
          <Field label="Clé privée" htmlFor={`key-${app}`}>
            <textarea id={`key-${app}`} className={cn(textareaClass, "min-h-40 font-mono text-xs")} spellCheck={false} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={priv} onChange={(e) => setPriv(e.target.value)} />
          </Field>
        )}
      </Dialog>
    </>
  );
}

const PRESETS = ["nextjs", "nextjs-standalone", "nextjs-export", "nuxt", "sveltekit", "astro-node", "astro-static", "react-router", "nestjs", "vite-spa", "static", "node"];

/** New app, like node-app-ui's form: recorded on the host (clone, detection), then deployed in the background. */
function CreateAppDialog({ h, onClose, onChanged }: { h: Host; onClose: () => void; onChanged?: () => void }) {
  const base = useBase(h);
  const toast = useToast();
  const [f, setF] = useState({ name: "", source: "", branch: "", preset: "", port: "", start: "", migrate: "", env: "", env_invalid: false, env_wins: true, private_key: "", auto_deploy: true, auto_update: true });
  const [key, setKey] = useState<string>();
  const [warnings, setWarnings] = useState<string>();
  const [busy, setBusy] = useState<"key" | "create">();
  const [error, setError] = useState<string>();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target instanceof HTMLInputElement && e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const ssh = isSshRepo(f.source);
  const showKey = async () => {
    setBusy("key"); setError(undefined);
    try { setKey((await api.post<{ key: string }>(`${base}/node-apps/${f.name}/key`, {})).key); } catch (e) { setError((e as Error).message); }
    setBusy(undefined);
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("create"); setError(undefined);
    try {
      const r = await api.post<{ warnings: string }>(`${base}/node-apps`, {
        name: f.name, source: f.source, branch: f.branch, preset: f.preset, port: Number(f.port) || 0, start: f.start, migrate: f.migrate,
        env: f.env, env_merge: f.env.trim() ? (f.env_wins ? "saisie" : "code") : "", private_key: f.private_key, auto_deploy: f.auto_deploy, auto_update: f.auto_update,
      });
      onChanged?.();
      toast(`${f.name} créée, déploiement lancé`, "success");
      if (r.warnings) setWarnings(r.warnings); else onClose();
    } catch (err) {
      if (err instanceof ApiError && typeof err.data.need_key === "string") setKey(err.data.need_key);
      setError((err as Error).message);
    }
    setBusy(undefined);
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={`Nouvelle application sur ${h.name}`}
      description="Même détection que node-app new : framework, commande de démarrage, migration et port sont proposés automatiquement si vous laissez les champs vides."
      footer={warnings !== undefined ? <Button onClick={onClose}>Terminer</Button> : <><Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button type="submit" form="node-create" icon={<Plus size={16} />} loading={busy === "create"} disabled={f.env_invalid} title={f.env_invalid ? "Variables à corriger" : undefined}>Créer et déployer</Button></>}>
      {warnings !== undefined ? (
        <Alert kind="warning" title="Application créée, avec des avertissements"><pre className="font-mono text-xs whitespace-pre-wrap">{warnings}</pre></Alert>
      ) : (
        <form id="node-create" className="grid gap-5" onSubmit={create}>
          {error && <Alert kind="error" title="Création impossible">{error}</Alert>}
          <div className={FIELD_ROW}>
            <Field label="Nom" htmlFor="nc-name" hint="Minuscules, chiffres, - et _" required>
              <input id="nc-name" className={inputClass} value={f.name} onChange={set("name")} required pattern="[a-z0-9][a-z0-9_\-]*" maxLength={100} autoFocus />
            </Field>
            <Field label="Branche ou tag" htmlFor="nc-branch" hint="Vide : branche par défaut du dépôt">
              <input id="nc-branch" className={inputClass} value={f.branch} onChange={set("branch")} maxLength={200} />
            </Field>
          </div>
          <Field label="Dépôt git" htmlFor="nc-source" required hint="Public : https://… · privé : git@github.com:compte/depot.git (deploy key) ou https://<token>@github.com/…">
            <input id="nc-source" className={cn(inputClass, "font-mono text-xs")} value={f.source} onChange={set("source")} required placeholder="git@github.com:compte/depot.git" />
          </Field>
          {ssh && (
            <div className="grid gap-3 rounded-xl border border-line p-4">
              <p className="text-sm text-body">Dépôt privé en SSH : ajoutez la deploy key de l'app au dépôt, en lecture seule (GitHub : Settings › Deploy keys).</p>
              {key ? <CodeBlock text={key} /> : (
                <Button variant="secondary" size="sm" icon={<KeyRound size={14} />} className="justify-self-start" loading={busy === "key"} disabled={!/^[a-z0-9][a-z0-9_-]*$/.test(f.name)} title={f.name ? undefined : "Indiquez d'abord le nom"} onClick={showKey}>Afficher la deploy key</Button>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-meta">Utiliser une clé SSH existante</summary>
                <textarea aria-label="Clé privée existante" className={cn(textareaClass, "mt-2 min-h-32 font-mono text-xs")} spellCheck={false} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={f.private_key} onChange={set("private_key")} />
              </details>
            </div>
          )}
          <div className={FIELD_ROW}>
            <Field label="Préréglage" htmlFor="nc-preset" hint="Impose la commande de démarrage d'un framework">
              <select id="nc-preset" className={inputClass} value={f.preset} onChange={set("preset")}>
                <option value="">Détection automatique</option>
                {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Port" htmlFor="nc-port" hint="Vide : PORT du .env, sinon le premier libre à partir de 3000">
              <input id="nc-port" type="number" min={1} max={65535} className={inputClass} value={f.port} onChange={set("port")} />
            </Field>
            <Field label="Commande de démarrage" htmlFor="nc-start" hint="Vide : détectée">
              <input id="nc-start" className={cn(inputClass, "font-mono text-xs")} value={f.start} onChange={set("start")} maxLength={500} />
            </Field>
            <Field label="Migration de base" htmlFor="nc-migrate" hint="Vide : détectée (Prisma, Drizzle…) · - : aucune">
              <input id="nc-migrate" className={cn(inputClass, "font-mono text-xs")} value={f.migrate} onChange={set("migrate")} maxLength={500} />
            </Field>
          </div>
          <div className="mm-field" role="group" aria-label="Variables d'environnement">
            <span className="mm-field__label">Variables d'environnement</span>
            <EnvVars onChange={(env, env_invalid) => setF((p) => ({ ...p, env, env_invalid }))} />
            <p className="mm-help">Ajoutées au .env du code s'il en a un</p>
          </div>
          {f.env.trim() && <Checkbox label="Ces variables remplacent celles du .env du code" hint="Décoché : le .env du code l'emporte en cas de doublon" checked={f.env_wins} onChange={set("env_wins")} />}
          <Checkbox label="Déployer chaque nouveau commit" hint="Vérifié toutes les 2 minutes, retour au commit précédent en cas d'échec" checked={f.auto_deploy} onChange={set("auto_deploy")} />
          <Checkbox label="Mettre à jour les dépendances chaque semaine" hint="pnpm update, retour arrière si l'app ne redémarre pas" checked={f.auto_update} onChange={set("auto_update")} />
        </form>
      )}
    </Dialog>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mm-label-caps">{label}</dt>
      <dd className="mt-1 truncate text-sm text-h2">{children || <span className="text-meta">—</span>}</dd>
    </div>
  );
}

function AppDialog({ h, app, onClose, onChanged }: { h: Host; app: NodeApp; onClose: () => void; onChanged?: () => void }) {
  const { run, busy } = useHostAction(() => onChanged?.(), useContext(NodeBase));
  const base = useBase(h);
  const [tab, setTab] = useState<"history" | "logs" | "env" | "pause">("history");
  const [picked, setPicked] = useState<string>();
  const [remove, setRemove] = useState<{ purge: boolean }>();
  const latest = app.history[0];
  // Right after a deploy, follow the new operation without a click.
  const shown = picked ?? (latest && opResult(latest) === "running" ? latest.id : undefined);
  const a = h.action?.action.startsWith("node_") && h.action.target === app.name ? h.action : undefined;
  const pending = !!a && actionBusy(h);
  const blocked = !h.connected ? "Agent hors ligne" : !h.node_apps?.actions ? "Actions désactivées sur cet hôte (NODE_APPS_ACTIONS=0)" : actionBusy(h) ? "Une action est déjà en cours sur cet hôte" : undefined;
  const [st, stTone] = STATUS[app.status] ?? [app.status, "muted" as Tone];
  const act = (action: NodeAction) => run(h, action, app.name);
  return (
    <Dialog open onClose={onClose} size="xl" title={app.name}
      description={<span className="inline-flex flex-wrap items-center gap-2"><Badge tone={stTone} dot>{st}</Badge>{app.port > 0 && <span className="font-mono text-xs">port {app.port}</span>}{app.managed_by_ansible && <Badge tone="blue">Géré par Ansible</Badge>}</span>}>
      <div className="grid gap-6">
        {app.managed_by_ansible && <Alert kind="info" title="Configuration écrite par le playbook">Modifiez plutôt nodejs_apps dans Ansible : la configuration de l'app est réécrite à chaque passage du playbook.</Alert>}
        {app.failed_commit && <Alert kind="error" title={`Échec du déploiement du commit ${short(app.failed_commit)}`}>L'app tourne toujours sur le dernier commit qui fonctionnait. Consultez le journal de l'opération ci-dessous.</Alert>}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Spec label="Source">{app.source === "local" ? "Code copié (sans dépôt)" : <span className="font-mono text-xs" title={app.repo}>{app.repo}</span>}</Spec>
          <Spec label="Branche">{app.branch && <span className="font-mono text-xs">{app.branch}</span>}</Spec>
          <Spec label="Commit déployé">{app.deployed_commit && <span className="font-mono text-xs" title={app.deployed_commit}>{short(app.deployed_commit)}</span>}</Spec>
          <Spec label="Démarrage"><span className="font-mono text-xs" title={app.start_command}>{app.start_command}</span></Spec>
          <Spec label="Migration">{app.migrate_command && app.migrate_command !== "-" && <span className="font-mono text-xs" title={app.migrate_command}>{app.migrate_command}</span>}</Spec>
          <Spec label="Automatique">{[app.auto_deploy && "déploiement à chaque commit", app.auto_update && "dépendances chaque semaine"].filter(Boolean).join(", ") || "désactivé"}</Spec>
        </dl>

        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((x) => (
              (x.action !== "node_pull" || app.source === "git") && (
                <Button key={x.action} variant="secondary" size="sm" icon={x.icon} title={blocked ?? x.hint} disabled={!!blocked}
                  loading={busy === `${h.id}:${x.action}:${app.name}`} onClick={() => act(x.action)}>{x.label}</Button>
              )
            ))}
            <Button variant="danger-ghost" size="sm" icon={<Trash2 size={14} />} title={blocked} disabled={!!blocked} onClick={() => setRemove({ purge: false })}>Supprimer</Button>
          </div>
          {pending && <span className="inline-flex items-center gap-1.5 text-xs text-meta"><LoaderCircle size={12} className="animate-spin" aria-hidden />Action en cours sur l'hôte…</span>}
          {a && !pending && (
            <details className="text-xs" open={a.state === "failed"}>
              <summary className={cn("cursor-pointer", a.state === "failed" ? "text-red" : "text-meta")}>{a.state === "failed" ? "Échec" : "Terminé"} {fmtAgo(a.at)}</summary>
              {a.message && <pre className="mt-2 max-h-52 overflow-auto rounded-xl border border-line bg-field p-3 font-mono text-xs whitespace-pre-wrap text-h2">{a.message}</pre>}
            </details>
          )}
        </div>

        <div className="grid gap-4">
          <Segmented label="Vue" value={tab} onChange={setTab} options={[["history", "Historique"], ["logs", "Logs de l'app"], ["env", "Variables"], ["pause", "Pause"]]} />
          {tab === "pause" ? <PauseEditor base={base} app={app.name} paused={app.status === "paused"} blocked={blocked} onChanged={onChanged} /> : tab === "env" ? <EnvEditor h={h} app={app.name} /> : tab === "logs" ? <AppLogs h={h} app={app.name} /> : (
            <>
              {app.history.length === 0 ? <p className="text-sm text-meta">Aucune opération enregistrée.</p> : (
                <div className="mm-table-wrap rounded-xl border border-line">
                  <table className="mm-table">
                    <thead><tr><th scope="col">Opération</th><th scope="col">Commit</th><th scope="col">Début</th><th scope="col">Durée</th><th scope="col">Résultat</th></tr></thead>
                    <tbody>
                      {app.history.map((o) => (
                        <tr key={o.id} className={cn("cursor-pointer", shown === o.id && "bg-field")} onClick={() => setPicked(o.id)}>
                          <td className="mm-col-strong"><button type="button" className="text-left text-inherit" onClick={() => setPicked(o.id)}>{KIND[o.kind] ?? o.kind}</button></td>
                          <td className="font-mono text-xs" title={o.commit}>{short(o.commit)}</td>
                          <td className="text-xs text-meta">{fmtDate(o.started)}</td>
                          <td className="font-mono text-xs">{o.finished ? `${Math.max(1, Math.round((o.finished - o.started) / 60))} min` : "—"}</td>
                          <td><ResultBadge o={o} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {shown && <OpLog key={shown} h={h} app={app.name} op={shown} />}
            </>
          )}
        </div>

        {app.source === "git" && <GitHook base={base} app={app.name} auto={app.auto_deploy} />}

        {(app.deploy_key || isSshRepo(app.repo)) && (
          <div className="grid gap-2">
            <p className="mm-label-caps">Deploy key (à ajouter au dépôt, en lecture seule)</p>
            {app.deploy_key && <CodeBlock text={app.deploy_key} />}
            <KeyActions h={h} app={app.name} onChanged={onChanged} />
          </div>
        )}
      </div>

      <Dialog open={!!remove} onClose={() => setRemove(undefined)} size="sm" title={`Supprimer ${app.name}`}
        description="node-app remove : l'app est arrêtée, sa configuration, ses variables et sa deploy key sont supprimées."
        footer={<><Button variant="secondary" onClick={() => setRemove(undefined)}>Annuler</Button>
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={() => { const p = remove!.purge; setRemove(undefined); act(p ? "node_purge" : "node_remove"); }}>Supprimer l'app</Button></>}>
        <div className="grid gap-4 text-sm leading-relaxed text-body">
          {app.managed_by_ansible && <Alert kind="info" title="Gérée par Ansible">Retirez-la aussi de nodejs_apps, sinon elle sera recréée au prochain passage du playbook.</Alert>}
          <Checkbox label="Supprimer aussi le code et l'historique" hint={`/srv/node-apps/${app.name} et ses journaux de déploiement`} checked={!!remove?.purge} onChange={(e) => setRemove({ purge: e.target.checked })} />
        </div>
      </Dialog>
    </Dialog>
  );
}

/** Node.js apps of one host (node-app of the base-node playbook): state, actions, history and logs. */
export function NodeAppsPanel({ h, onChanged, base }: { h: Host; onChanged?: () => void; base?: string }) {
  const [open, setOpen] = useState<string>();
  const [creating, setCreating] = useState(false);
  const snap = h.node_apps!;
  const blocked = writeBlock(h);
  const current = snap.apps.find((a) => a.name === open);
  const ui = nodeUiUrl(h);
  return (
    <NodeBase.Provider value={base}>
    <div className="grid gap-4">
      <Card flush title={`${snap.online}/${snap.apps.length} en ligne`} sub={`Relevé ${fmtAgo(snap.collected_at)}${snap.actions ? "" : " · lecture seule"}`}
        actions={<span className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Plus size={14} />} disabled={!!blocked} title={blocked} onClick={() => setCreating(true)}>Nouvelle app</Button>
          {ui && <ButtonAnchor variant="secondary" size="sm" icon={<ExternalLink size={14} />} href={ui} target="_blank" rel="noreferrer" title="Interface node-app-ui de l'hôte (certificat auto-signé à accepter au premier accès)">Ouvrir Node.js UI</ButtonAnchor>}
        </span>}>
        {snap.error && <Alert kind="error" title="node-app a signalé une erreur" className="m-4">{snap.error}</Alert>}
        <div className="mm-table-wrap">
          <table className="mm-table min-w-[52rem]">
            <thead><tr><th scope="col">Application</th><th scope="col">État</th><th scope="col" className="mm-col-num">Port</th><th scope="col" className="mm-col-num">Mémoire</th><th scope="col">Dernière opération</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {snap.apps.length === 0 && <tr><td colSpan={6} className="text-center text-meta">Aucune application. Créez-en une avec « Nouvelle app », ou node-app new sur l'hôte.</td></tr>}
              {snap.apps.map((a) => {
                const [st, stTone] = STATUS[a.status] ?? [a.status, "muted" as Tone];
                const last = a.history[0];
                return (
                  <tr key={a.name}>
                    <td className="mm-col-strong max-w-[22rem]">
                      <span className="flex min-w-0 items-center gap-2.5 py-1.5">
                        <StatusIcon kind={appKind(a)} />
                        <span className="min-w-0">
                          <span className="block truncate">{a.name}</span>
                          <span className="block truncate font-mono text-xs font-normal text-meta" title={a.repo}>{a.source === "local" ? "code local" : `${a.repo.replace(/^.*[/:]([^/:]+\/[^/]+?)(\.git)?$/, "$1")} · ${a.branch}`}</span>
                        </span>
                      </span>
                    </td>
                    <td>
                      <Badge tone={stTone} dot>{st}</Badge>
                      {a.restarts > 0 && <span className="mt-0.5 block text-xs text-meta">{a.restarts} redémarrage(s)</span>}
                      {a.failed_commit && <span className="mt-0.5 block text-xs text-red">échec de {short(a.failed_commit)}</span>}
                    </td>
                    <td className="mm-col-num font-mono text-xs">{a.port || "—"}</td>
                    <td className="mm-col-num font-mono text-xs">{a.status === "online" ? `${a.memory_mb} Mo` : "—"}</td>
                    <td>{last ? <span className="inline-flex flex-wrap items-center gap-2"><ResultBadge o={last} /><span className="text-xs text-meta">{KIND[last.kind] ?? last.kind} · {fmtAgo(last.started)}</span></span> : <span className="text-meta">—</span>}</td>
                    <td className="w-px text-right"><Button variant="secondary" size="sm" onClick={() => setOpen(a.name)}>Gérer</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {snap.ssh_keys.length > 0 && (
        <Card flush title="Clés SSH" sub="Clés partagées (essayées pour tous les dépôts) et deploy keys des apps. Remplacement et import : fiche de l'app (Gérer).">
          <div className="mm-table-wrap">
            <table className="mm-table">
              <thead><tr><th scope="col">Clé</th><th scope="col">Type</th><th scope="col">Empreinte</th></tr></thead>
              <tbody>{snap.ssh_keys.map((k) => (
                <tr key={k.id}><td className="mm-col-strong">{k.name}<span className="block text-xs font-normal text-meta">{k.kind === "app" ? "deploy key" : "clé partagée"}</span></td><td className="font-mono text-xs">{k.type}</td><td className="font-mono text-xs break-all">{k.fingerprint}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
      {current && <AppDialog h={h} app={current} onClose={() => setOpen(undefined)} onChanged={onChanged} />}
      {creating && <CreateAppDialog h={h} onClose={() => setCreating(false)} onChanged={onChanged} />}
    </div>
    </NodeBase.Provider>
  );
}
