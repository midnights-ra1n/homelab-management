import { useState } from "react";
import { Box, Cloud, Cpu, HardDrive, Server, Wrench } from "../shared/icons";
import { actionBusy, api, type Host, type HostType } from "../api";
import { Alert, Button, CodeBlock, Dialog, Switch, useToast } from "../ui";
import { REPO } from "./AddHostWizard";

/** Deployment types with their default options, as in the "Ajouter un hôte" wizard. */
export const TYPE_CHOICES: { id: HostType; label: string; hint: string; icon: typeof Server; smart: boolean }[] = [
  { id: "proxmox", label: "Serveur Proxmox", hint: "Hyperviseur avec ses disques et ses conteneurs", icon: Server, smart: true },
  { id: "physical", label: "Serveur physique", hint: "NAS, serveur dédié, poste", icon: HardDrive, smart: true },
  { id: "vm", label: "Machine virtuelle", hint: "VM d'un hyperviseur, sans SMART", icon: Cpu, smart: false },
  { id: "lxc", label: "Conteneur LXC", hint: "Conteneur d'un Proxmox, sans SMART", icon: Box, smart: false },
  { id: "vps", label: "VPS", hint: "Serveur loué chez un hébergeur", icon: Cloud, smart: false },
];

export interface Reconfigure { type: HostType; smart: boolean; autoUpdate: boolean; lxc: "keep" | "all" | "none" }

/** Options of the reconfigure_agent action, in the order checked by the hub (reconfigureRe). */
export const reconfigureTarget = (o: Reconfigure) => `HOST_TYPE=${o.type} SMART=${o.smart} AUTO_UPDATE=${o.autoUpdate} LXC=${o.lxc}`;

/** install.sh re-run on the machine: no TOKEN, so the hub, token and key of agent.env are kept.
 *  An agent installed by the .deb re-runs the package's own script (as apt-action.sh does). */
export function reinstallCommand(o: Reconfigure, deb = false) {
  const env = [`HOST_TYPE=${o.type}`, `SMART=${o.smart}`, `AUTO_UPDATE=${o.autoUpdate}`];
  if (o.lxc === "all") env.push("LXC=all");
  if (o.lxc === "none") env.push("LXC=none");
  if (deb) return `sudo ${env.join(" ")} INSTALL_METHOD=deb BUNDLE=/usr/share/hlm-agent sh /usr/share/hlm-agent/install.sh`;
  return `curl -fsSL https://raw.githubusercontent.com/${REPO}/stable/agent/install.sh | sudo ${env.join(" ")} sh`;
}

/** Changes the deployment type of a host: saved in the hub, then applied by the agent itself or by a command. */
export function DeploymentTypeDialog({ h, open, onClose, onDone }: { h: Host; open: boolean; onClose: () => void; onDone: (h: Host) => void }) {
  const toast = useToast();
  const initial = TYPE_CHOICES.find((t) => t.id === h.host_type) ?? TYPE_CHOICES[2];
  const [o, setO] = useState<Reconfigure>({ type: initial.id, smart: initial.smart, autoUpdate: true, lxc: h.lxc_sync ? "keep" : "all" });
  const [busy, setBusy] = useState<"save" | "apply">();
  const pick = (t: (typeof TYPE_CHOICES)[number]) => setO({ ...o, type: t.id, smart: t.smart, lxc: t.id === "proxmox" ? (h.lxc_sync ? "keep" : "all") : h.lxc_sync ? "none" : "keep" });
  const blocked = !h.connected ? "Agent hors ligne : utilisez la commande" : actionBusy(h) ? "Une action est déjà en cours sur cet hôte" : undefined;

  const save = async (apply: boolean) => {
    setBusy(apply ? "apply" : "save");
    try {
      let updated = await api.patch<Host>(`/api/hosts/${h.id}`, { type: o.type });
      if (apply) updated = await api.post<Host>(`/api/hosts/${h.id}/action`, { action: "reconfigure_agent", target: reconfigureTarget(o) });
      onDone(updated);
      toast(apply ? `Réinstallation de l'agent lancée sur ${h.name}` : "Type enregistré", "success");
      onClose();
    } catch (e) { toast((e as Error).message, "error"); }
    setBusy(undefined);
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`Type de déploiement de ${h.name}`}
      description="Le type est enregistré dans le hub et repris par l'inventaire. Appliqué sur l'hôte, l'agent est réinstallé avec ses options : SMART, mise à jour automatique, conteneurs LXC, et nouvelle détection de Docker et des applications Node.js. La configuration de l'agent (hub, jeton) est conservée."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button variant="secondary" loading={busy === "save"} onClick={() => save(false)}>Enregistrer seulement</Button>
        <Button icon={<Wrench size={16} />} loading={busy === "apply"} disabled={!!blocked} title={blocked} onClick={() => save(true)}>Appliquer sur l'hôte</Button>
      </>}>
      <div className="grid gap-5">
        <fieldset className="mm-field">
          <legend className="mm-field__label mb-1.5">Type de machine</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup">
            {TYPE_CHOICES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={o.type === t.id}
                className="flex flex-col items-start gap-1 rounded-xl border border-line-subtle bg-box p-3 text-left transition-colors hover:border-line-strong aria-checked:border-accent aria-checked:bg-accent-soft"
                onClick={() => pick(t)}>
                <span className="mb-1 flex size-8 items-center justify-center rounded-full bg-accent-soft text-accent-text"><t.icon size={16} aria-hidden /></span>
                <span className="text-sm font-medium text-h1">{t.label}</span>
                <span className="text-xs text-meta">{t.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Switch label="Surveiller les disques (SMART, installe smartmontools)" checked={o.smart} onChange={(smart) => setO({ ...o, smart })} />
        <Switch label="Mise à jour automatique quotidienne de l'agent" checked={o.autoUpdate} onChange={(autoUpdate) => setO({ ...o, autoUpdate })} />
        {o.type === "proxmox" && (
          <Switch label="Installer aussi dans les conteneurs LXC Debian démarrés, puis dans les nouveaux"
            hint={h.lxc_sync ? "Déjà actif : décoché, l'installation automatique s'arrête." : undefined}
            checked={o.lxc !== "none" && (o.lxc === "all" || h.lxc_sync)}
            onChange={(v) => setO({ ...o, lxc: v ? (h.lxc_sync ? "keep" : "all") : h.lxc_sync ? "none" : "keep" })} />
        )}
        {o.type !== "proxmox" && h.lxc_sync && <Alert kind="info" title="Conteneurs LXC">L'installation automatique dans les conteneurs de ce Proxmox sera arrêtée.</Alert>}

        <div className="grid gap-2">
          <p className="mm-label-caps">Ou sur la machine</p>
          <p className="text-sm text-body">Même effet, à lancer une fois si le bouton signale un helper trop ancien (agents installés avant cette version). Le jeton et le hub de l'agent sont conservés.</p>
          <CodeBlock text={reinstallCommand(o, h.info.install === "deb")} />
        </div>
      </div>
    </Dialog>
  );
}
