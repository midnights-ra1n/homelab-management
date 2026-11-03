import { useEffect, useState } from "react";
import { Plus, Trash2 } from "../shared/icons";
import { api, fmtAgo, fmtDate, type Install } from "../api";
import { Alert, Badge, Button, Card, CodeBlock, Dialog, Field, IconButton, Segmented, Switch, inputClass } from "../ui";
import { HubUrlField, KINDS, KindPicker, UNINSTALL_COMMAND, installCommand, type Kind } from "./AddHostWizard";

interface EnrollToken { id: number; name: string; prefix: string; expires_at: number | null; created_at: number; last_used_at: number; uses: number }

const EXPIRY: [string, string, number | null][] = [["1", "24 heures", 1], ["7", "7 jours", 7], ["30", "30 jours", 30], ["never", "Jamais", null]];

/**
 * Shared enrollment token: one TOKEN + KEY for every machine. Each agent enrolls itself
 * under its hostname on first connection and then switches to a personal token.
 */
export function MassDeployDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tokens, setTokens] = useState<EnrollToken[]>([]);
  const [name, setName] = useState("Déploiement");
  const [expiry, setExpiry] = useState("7");
  const [created, setCreated] = useState<Install>();
  const [hub, setHub] = useState("");
  const [method, setMethod] = useState<"curl" | "ansible">("ansible");
  const [kind, setKind] = useState<Kind>("vm");
  const [withLxc, setWithLxc] = useState(true);
  const { smart, hostType } = KINDS.find((k) => k.id === kind)!;
  const [error, setError] = useState<string>();
  const load = () => api.get<EnrollToken[]>("/api/enroll-tokens").then(setTokens, () => {});
  useEffect(() => { if (open) load(); }, [open]);

  const create = async () => {
    setError(undefined);
    const days = EXPIRY.find((x) => x[0] === expiry)?.[2];
    try {
      const r = await api.post<{ install: Install }>("/api/enroll-tokens", { name, expires_at: days ? Math.floor(Date.now() / 1000) + days * 86400 : null });
      setCreated(r.install);
      setHub(r.install.hub_url);
      load();
    } catch (e) { setError((e as Error).message); }
  };
  const close = () => { setCreated(undefined); setError(undefined); onClose(); };
  const install = created && { ...created, hub_url: hub.trim().replace(/\/$/, "") };

  return (
    <Dialog open={open} onClose={close} size="lg" title="Déploiement en masse"
      description="Un seul jeton et une seule clé pour toutes les machines : chacune s'inscrit sous son nom à sa première connexion."
      footer={<Button onClick={close}>Terminer</Button>}>
      <div className="grid gap-5">
        {!install ? (
          <>
            {error && <Alert kind="error" title={error} />}
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Field label="Nom du jeton" htmlFor="enr-name"><input id="enr-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Valable" htmlFor="enr-exp">
                <select id="enr-exp" className={inputClass} value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                  {EXPIRY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <div><Button icon={<Plus size={16} />} onClick={create}>Créer le jeton commun</Button></div>
            </div>
            <p className="text-sm text-body">Le jeton commun ne sert qu'à inscrire de nouvelles machines ; chacune reçoit ensuite son propre jeton. Une durée courte suffit : les machines déjà inscrites continuent de fonctionner après l'expiration.</p>
          </>
        ) : (
          <>
            <Alert kind="warning" title="Le jeton ne sera plus affiché">Copie-le maintenant (dans un vault Ansible, par exemple).</Alert>
            <HubUrlField value={hub} onChange={setHub} />
            <KindPicker value={kind} onChange={(k) => setKind(k.id)} />
            <Segmented className="w-fit" label="Méthode" value={method} onChange={setMethod} options={[["ansible", "Ansible"], ["curl", "Commande"]]} />
            {method === "ansible" ? (
              <>
                <p className="text-sm text-body">Dans <code className="font-mono text-xs text-h2">group_vars/&lt;groupe&gt;/main.yml</code> de votre playbook, avec le rôle <code className="font-mono text-xs text-h2">hlm_agent</code> (voir docs/ANSIBLE.md) :</p>
                <CodeBlock text={[
                  `hlm_hub_url: ${install.hub_url}`,
                  `hlm_key: "${install.key}"`,
                  `hlm_agent_token: "{{ vault_hlm_agent_token }}"`,
                  `hlm_smart: ${smart}`,
                ].join("\n")} />
                {kind === "proxmox" && <p className="text-sm text-body">Le rôle Ansible n'installe pas l'agent dans les conteneurs LXC : une fois le Proxmox inscrit, utilisez <span className="text-h2">Passer en serveur Proxmox</span> sur sa fiche, ou la méthode Commande.</p>}
                <p className="text-sm text-body">et dans le vault (<code className="font-mono text-xs text-h2">ansible-vault create group_vars/&lt;groupe&gt;/vault.yml</code>) :</p>
                <CodeBlock text={`vault_hlm_agent_token: ${install.token}`} />
              </>
            ) : (
              <>
                <p className="text-sm text-body">La même ligne fonctionne sur toutes les machines :</p>
                {kind === "proxmox" && <Switch label="Installer aussi dans les conteneurs LXC Debian démarrés, puis dans les nouveaux" checked={withLxc} onChange={setWithLxc} />}
                <CodeBlock text={installCommand(install, { smart, autoUpdate: true, hostType, lxc: kind === "proxmox" && withLxc })} />
              </>
            )}
          </>
        )}

        {tokens.length > 0 && (
          <Card flush title="Jetons communs" sub={`${tokens.length} jeton(s)`}>
            <div className="mm-table-wrap">
              <table className="mm-table">
                <thead><tr><th scope="col">Nom</th><th scope="col">Expiration</th><th scope="col" className="mm-col-num">Inscriptions</th><th scope="col">Dernière</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{tokens.map((t) => {
                  const expired = t.expires_at != null && t.expires_at * 1000 < Date.now();
                  return (
                    <tr key={t.id}>
                      <td className="mm-col-strong"><span className="block">{t.name}</span><span className="block font-mono text-xs font-normal text-meta">{t.prefix}…</span></td>
                      <td>{t.expires_at == null ? "Jamais" : expired ? <Badge tone="orange" dot>Expiré</Badge> : fmtDate(t.expires_at)}</td>
                      <td className="mm-col-num font-mono text-xs">{t.uses}</td>
                      <td className="mm-col-muted">{t.last_used_at ? fmtAgo(t.last_used_at) : "—"}</td>
                      <td className="w-px"><IconButton label={`Révoquer ${t.name}`} icon={<Trash2 size={15} />} onClick={() => api.del(`/api/enroll-tokens/${t.id}`).then(load)} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Card>
        )}
        <details className="text-sm">
          <summary className="cursor-pointer text-meta hover:text-h1">Désinstaller l'agent d'une machine</summary>
          <div className="mt-2"><CodeBlock text={UNINSTALL_COMMAND} /></div>
        </details>
      </div>
    </Dialog>
  );
}
