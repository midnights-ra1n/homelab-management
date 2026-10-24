import { useEffect, useState } from "react";
import { Download, ExternalLink, GitPullRequestArrow, LoaderCircle, Package, RotateCw, Square, Trash2 } from "lucide-react";
import { actionBusy, api, fmtAgo, fmtDate, type Host, type NodeAction, type NodeApp, type NodeOp } from "../api";
import {
  Alert, Badge, Button, ButtonAnchor, Card, Checkbox, CodeBlock, Dialog, Segmented, Skeleton, StatusIcon, cn,
  type StatusKind, type Tone, usePoll,
} from "../ui";
import { useHostAction } from "./AgentVersion";

const STATUS: Record<string, [string, Tone]> = {
  online: ["En ligne", "green"], stopped: ["Arrêtée", "muted"], errored: ["En erreur", "red"],
  launching: ["Démarre", "yellow"], stopping: ["S'arrête", "yellow"],
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
  a.status === "errored" ? "down" : a.status === "online" ? (a.failed_commit ? "warn" : "ok") : a.status === "stopped" ? "paused" : "warn";

/** Address of the host for the node-app-ui link: first IPv4 that is not loopback or a bridge (as hostAddress in Go). */
const hostAddress = (h: Host) =>
  h.info.ips?.find((i) => !i.address.includes(":") && !i.address.startsWith("127.") && !/^(lo|docker|br-|veth|virbr)/.test(i.iface))?.address ?? h.info.hostname;

function ResultBadge({ o }: { o: NodeOp }) {
  const [label, tone] = RESULT[opResult(o)] ?? [o.result, "muted" as Tone];
  return <Badge tone={tone} dot>{label}</Badge>;
}

/** Log of one operation, followed while it runs (like node-app-ui: read from an offset every 1.5 s). */
function OpLog({ h, app, op }: { h: Host; app: string; op: string }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<{ running: boolean; error?: string }>({ running: true });
  useEffect(() => {
    let offset = 0, stop = false, timer = 0;
    setText("");
    setState({ running: true });
    const step = async () => {
      try {
        const r = await api.get<{ text: string; offset: number; operation: NodeOp | null }>(`/api/hosts/${h.id}/node-apps/${app}/operations/${op}?offset=${offset}`);
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
  const [lines, setLines] = useState<"100" | "500" | "2000">("100");
  const { data, error } = usePoll(() => api.get<{ text: string }>(`/api/hosts/${h.id}/node-apps/${app}/logs?lines=${lines}`), 4000, [h.id, app, lines]);
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

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mm-label-caps">{label}</dt>
      <dd className="mt-1 truncate text-sm text-h2">{children || <span className="text-meta">—</span>}</dd>
    </div>
  );
}

function AppDialog({ h, app, onClose, onChanged }: { h: Host; app: NodeApp; onClose: () => void; onChanged?: () => void }) {
  const { run, busy } = useHostAction(() => onChanged?.());
  const [tab, setTab] = useState<"history" | "logs">("history");
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
          <Segmented label="Vue" value={tab} onChange={setTab} options={[["history", "Historique"], ["logs", "Logs de l'app"]]} />
          {tab === "logs" ? <AppLogs h={h} app={app.name} /> : (
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

        {app.deploy_key && (
          <div className="grid gap-2">
            <p className="mm-label-caps">Deploy key (à ajouter au dépôt, en lecture seule)</p>
            <CodeBlock text={app.deploy_key} />
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
export function NodeAppsPanel({ h, onChanged }: { h: Host; onChanged?: () => void }) {
  const [open, setOpen] = useState<string>();
  const snap = h.node_apps!;
  const current = snap.apps.find((a) => a.name === open);
  const ui = snap.ui_port > 0 ? `https://${hostAddress(h)}:${snap.ui_port}` : "";
  return (
    <div className="grid gap-4">
      <Card flush title={`${snap.online}/${snap.apps.length} en ligne`} sub={`Relevé ${fmtAgo(snap.collected_at)}${snap.actions ? "" : " · lecture seule"}`}
        actions={ui && <ButtonAnchor variant="secondary" size="sm" icon={<ExternalLink size={14} />} href={ui} target="_blank" rel="noreferrer" title="Variables d'environnement, nouvelle app et clés SSH : ces données sensibles ne passent pas par le monitoring">node-app-ui</ButtonAnchor>}>
        {snap.error && <Alert kind="error" title="node-app a signalé une erreur" className="m-4">{snap.error}</Alert>}
        <div className="mm-table-wrap">
          <table className="mm-table min-w-[52rem]">
            <thead><tr><th scope="col">Application</th><th scope="col">État</th><th scope="col" className="mm-col-num">Port</th><th scope="col" className="mm-col-num">Mémoire</th><th scope="col">Dernière opération</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {snap.apps.length === 0 && <tr><td colSpan={6} className="text-center text-meta">Aucune application. Créez-en une avec node-app new ou depuis node-app-ui.</td></tr>}
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
        <Card flush title="Clés SSH" sub="Clés partagées (essayées pour tous les dépôts) et deploy keys des apps. Création et import : node-app-ui.">
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
    </div>
  );
}
