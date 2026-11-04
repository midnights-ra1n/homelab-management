import { useState, type FormEvent } from "react";
import { Plus, ShieldCheck, Trash2 } from "./icons";
import { api } from "../api";
import { Alert, Badge, Button, Card, Dialog, Field, FIELD_ROW, IconButton, Segmented, Skeleton, inputClass, usePoll, useToast } from "../ui";

type Chain = { name: string; policy: string; rules: string[] };
type Table = { table: string; chains: Chain[] };
type Family = { family: "4" | "6"; saved: boolean; tables: Table[] };
type State = { available: boolean; persistent: boolean; writable: boolean; families: Family[] };
type Change = Record<string, string>;

/** Chains their owner rewrites on its own: shown, never edited from here. */
const managedBy = (chain: string) =>
  /^DOCKER/.test(chain) ? "Docker" : chain.startsWith("f2b-") ? "fail2ban" : chain.startsWith("PVEFW-") ? "Proxmox" : chain.startsWith("ufw") ? "ufw" : "";
/** A rule as it reads in its chain, without "-A CHAIN". */
const ruleText = (chain: string, rule: string) => rule.slice(`-A ${chain} `.length);

function RuleDialog({ family, chains, onClose, send }: { family: string; chains: string[]; onClose: () => void; send: (c: Change) => Promise<boolean> }) {
  const [f, setF] = useState({ chain: chains.includes("INPUT") ? "INPUT" : chains[0], position: "top", proto: "tcp", dport: "", source: "", iface: "", target: "ACCEPT", comment: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await send({ ...f, op: "add", family })) onClose();
    setBusy(false);
  };
  return (
    <Dialog open onClose={onClose} title={`Nouvelle règle IPv${family}`} description="Appliquée tout de suite sur l'hôte, dans la table filter."
      footer={<Button type="submit" form="fw-rule" loading={busy}>Ajouter la règle</Button>}>
      <form id="fw-rule" className="grid gap-5" onSubmit={submit}>
        <div className={FIELD_ROW}>
          <Field label="Chaîne" htmlFor="fw-chain" hint={f.chain.startsWith("FW-") ? "Réécrite à chaque passage du rôle firewall du playbook." : undefined}>
            <select id="fw-chain" className={inputClass} value={f.chain} onChange={set("chain")}>{chains.map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Action" htmlFor="fw-target">
            <select id="fw-target" className={inputClass} value={f.target} onChange={set("target")}>
              <option value="ACCEPT">Autoriser (ACCEPT)</option><option value="DROP">Ignorer (DROP)</option><option value="REJECT">Refuser (REJECT)</option>
            </select>
          </Field>
          <Field label="Protocole" htmlFor="fw-proto">
            <select id="fw-proto" className={inputClass} value={f.proto} onChange={set("proto")}>
              <option value="tcp">TCP</option><option value="udp">UDP</option><option value="icmp">ICMP</option><option value="all">Tous</option>
            </select>
          </Field>
          <Field label="Port de destination" htmlFor="fw-port" hint="443, ou 8000:8100 pour une plage">
            <input id="fw-port" className={inputClass} value={f.dport} onChange={set("dport")} disabled={f.proto !== "tcp" && f.proto !== "udp"} inputMode="numeric" />
          </Field>
          <Field label="Source" htmlFor="fw-source" hint="Adresse ou réseau. Vide : toutes les sources">
            <input id="fw-source" className={inputClass} value={f.source} onChange={set("source")} placeholder={family === "4" ? "192.168.1.0/24" : "fd00::/8"} />
          </Field>
          <Field label="Interface d'entrée" htmlFor="fw-iface" hint="Vide : toutes les interfaces">
            <input id="fw-iface" className={inputClass} value={f.iface} onChange={set("iface")} placeholder="eth0" />
          </Field>
        </div>
        <Field label="Commentaire" htmlFor="fw-comment">
          <input id="fw-comment" className={inputClass} value={f.comment} onChange={set("comment")} maxLength={100} />
        </Field>
        <Field label="Position" hint="Sur un hôte déployé par playbook, INPUT saute d'abord vers FW-INPUT : un blocage doit être placé au début.">
          <Segmented label="Position dans la chaîne" value={f.position} options={[["top", "Au début"], ["bottom", "À la fin"]]} onChange={(position) => setF({ ...f, position })} />
        </Field>
      </form>
    </Dialog>
  );
}

function ChainCard({ chain, writable, ask }: { chain: Chain; writable: boolean; ask: (c: { title: string; text: string; change: Change }) => void }) {
  const owner = managedBy(chain.name);
  const edit = writable && !owner;
  return (
    <div className="border-t border-line-subtle px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-h1">{chain.name}</span>
        {owner && <Badge tone="muted">{`Géré par ${owner}`}</Badge>}
        {chain.name.startsWith("FW-") && <Badge tone="blue" title="Le rôle firewall réécrit cette chaîne à chaque passage">Playbook</Badge>}
        {chain.policy !== "-" && (
          <label className="ml-auto flex items-center gap-2 text-xs text-meta">
            Par défaut
            <select className={`${inputClass} w-auto`} value={chain.policy} disabled={!edit}
              onChange={(e) => ask({ title: `Politique de ${chain.name}`, text: `Le trafic sans règle dans ${chain.name} passera en ${e.target.value}.`, change: { op: "policy", chain: chain.name, policy: e.target.value } })}>
              <option>ACCEPT</option><option>DROP</option>
            </select>
          </label>
        )}
      </div>
      {chain.rules.length === 0
        ? <p className="mt-1 text-xs text-meta">Aucune règle.</p>
        : <ul className="mt-2 grid gap-1">
            {chain.rules.map((r) => (
              <li key={r} className="flex items-center justify-between gap-3 rounded-lg bg-page px-3 py-1.5">
                <code className="min-w-0 font-mono text-xs break-all text-h2">{ruleText(chain.name, r)}</code>
                {edit && <IconButton label="Supprimer la règle" icon={<Trash2 size={14} />}
                  onClick={() => ask({ title: "Supprimer la règle", text: r, change: { op: "delete", rule: r } })} />}
              </li>
            ))}
          </ul>}
    </div>
  );
}

/** iptables of a host, through its agent's root helper (monitoring: /api/hosts/{id}, management: its relay). */
export function IptablesPanel({ base }: { base: string }) {
  const toast = useToast();
  const { data, error, refresh } = usePoll(() => api.get<State>(`${base}/iptables`), 30_000, [base]);
  const [picked, setPicked] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; text: string; change: Change }>();
  const [busy, setBusy] = useState("");

  const post = async (body: Change, done: string) => {
    setBusy(body.op);
    try {
      await api.post(`${base}/iptables`, body);
      toast(done, "success");
      refresh();
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy("");
    }
  };

  if (error && !data) return <Alert kind="error" title="Pare-feu illisible">{error}</Alert>;
  if (!data) return <Skeleton className="h-40 rounded-2xl" />;
  const fam = data.families.find((f) => f.family === picked) ?? data.families[0];
  const filter = fam?.tables.find((t) => t.table === "filter");
  const others = fam?.tables.filter((t) => t !== filter && t.chains.some((c) => c.rules.length)) ?? [];
  const chains = filter?.chains.filter((c) => !managedBy(c.name) || c.rules.length) ?? [];
  const install = (
    <Button size="sm" variant="secondary" loading={busy === "install"} disabled={!data.writable}
      onClick={() => post({ op: "install" }, "iptables-persistent installé")}>Installer</Button>
  );
  return (
    <div className="grid gap-4">
      {!data.available && <Alert kind="warning" title="iptables n'est pas installé sur cet hôte" action={install} />}
      {data.available && !data.persistent && <Alert kind="warning" title="netfilter-persistent n'est pas installé" action={install}>Sans lui, les règles disparaissent au redémarrage.</Alert>}
      {fam && (
        <Card flush title={`Règles IPv${fam.family}`}
          sub={<>Les changements s'appliquent tout de suite. S'ils coupent l'agent, ils sont annulés au bout de 60 s.{data.writable ? "" : " Lecture seule."}</>}
          actions={<span className="flex flex-wrap items-center gap-2">
            {data.families.length > 1 && <Segmented size="sm" label="Famille d'adresses" value={fam.family} options={data.families.map((f) => [f.family, `IPv${f.family}`] as [string, string])} onChange={setPicked} />}
            <Badge tone={fam.saved ? "green" : "yellow"} dot>{fam.saved ? "Enregistré" : "Non enregistré"}</Badge>
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} disabled={!data.writable || !filter} onClick={() => setAdding(true)}>Nouvelle règle</Button>
            <Button size="sm" icon={<ShieldCheck size={14} />} loading={busy === "save"} disabled={!data.writable || !data.persistent}
              title="netfilter-persistent save : recharge ces règles au redémarrage" onClick={() => post({ op: "save" }, "Règles enregistrées")}>Enregistrer</Button>
          </span>}>
          {chains.map((c) => <ChainCard key={c.name} chain={c} writable={data.writable} ask={setConfirm} />)}
          {others.map((t) => (
            <details key={t.table} className="border-t border-line-subtle px-4 py-3">
              <summary className="cursor-pointer text-sm text-meta">Table {t.table} (lecture seule)</summary>
              <pre className="mt-2 overflow-x-auto font-mono text-xs text-h2">{t.chains.flatMap((c) => c.rules).join("\n")}</pre>
            </details>
          ))}
        </Card>
      )}
      {adding && filter && <RuleDialog family={fam.family} chains={filter.chains.filter((c) => !managedBy(c.name)).map((c) => c.name)} onClose={() => setAdding(false)}
        send={(c) => post(c, "Règle ajoutée. Pense à enregistrer.")} />}
      <Dialog open={!!confirm} onClose={() => setConfirm(undefined)} size="sm" title={confirm?.title}
        footer={<Button loading={!!busy} onClick={async () => { await post({ ...confirm!.change, family: fam.family }, "Modification appliquée. Pense à enregistrer."); setConfirm(undefined); }}>Confirmer</Button>}>
        <p className="text-sm break-all text-h2">{confirm?.text}</p>
      </Dialog>
    </div>
  );
}
