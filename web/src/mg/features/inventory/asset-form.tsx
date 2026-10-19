
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { saveAssetAction } from "@/actions/inventory";
import { Button, ButtonLink } from "@/components/ui/button";
import { ActionForm, Fieldset, FORM_ACTIONS_CLASS, inputClass, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { KindIcon } from "@/components/kind-icon";
import { macError, NetworkFields, useNetworkState, type SubnetOption } from "./network-fields";
import { SectionNav } from "./section-nav";
import { TagInput } from "./tag-input";
import {
  ASSET_KINDS,
  ASSET_KIND_META,
  ASSET_STATUSES,
  ASSET_STATUS_META,
  DISK_TYPES,
  DISK_TYPE_LABEL,
  RAM_TYPES,
  type AssetKind,
} from "@/lib/constants";
import type { Asset, AssetOption, Disk, Nic } from "@/lib/data/assets";
import { cn, formatGb } from "@/lib/utils";
import { useT } from "@/i18n/client";

export function AssetForm({
  asset,
  defaultKind = "physical",
  defaultParent,
  parents,
  subnets,
  proxmox,
  tags,
}: {
  asset?: Asset;
  defaultKind?: AssetKind;
  defaultParent?: number;
  parents: AssetOption[];
  subnets: SubnetOption[];
  proxmox: { id: number; name: string }[];
  tags: string[];
}) {
  const tr = useT();
  const [kind, setKind] = useState<AssetKind>(asset?.kind ?? defaultKind);
  const [disks, setDisks] = useState<Disk[]>(asset?.disks ?? []);
  const [nics, setNics] = useState<Nic[]>(asset?.nics ?? []);
  const [mac, setMac] = useState(asset?.primary_mac ?? "");
  // Nouvel élément créé depuis un hôte (« Ajouter » sur sa fiche) : on reprend son sous-réseau.
  const initialHost = !asset && defaultParent ? parents.find((p) => p.id === defaultParent) : undefined;
  const net = useNetworkState({ subnetId: asset?.subnet_id ?? initialHost?.subnet_id, ip: asset?.primary_ip });
  useEffect(() => {
    if (initialHost?.subnet_id) net.suggest(initialHost.subnet_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule proposition, au montage
  }, []);

  const isPhysical = kind === "physical" || kind === "network" || kind === "other";
  const isGuest = kind === "vm" || kind === "lxc";
  const isDocker = kind === "docker";
  const totalDisk = disks.reduce((n, d) => n + (Number(d.capacity_gb) || 0), 0);

  const action = saveAssetAction.bind(null, asset?.id ?? null);

  const sections = [
    { id: "type", label: tr("Type") },
    { id: "identite", label: tr("Identité") },
    { id: "reseau", label: tr("Réseau") },
    { id: "systeme", label: tr("Système") },
    isPhysical && { id: "materiel", label: tr("Matériel") },
    !isDocker && { id: "ressources", label: tr("Ressources") },
    isGuest && { id: "proxmox", label: "Proxmox" },
    isDocker && { id: "docker", label: "Docker" },
    { id: "notes", label: tr("Notes") },
  ].filter(Boolean) as { id: string; label: string }[];

  return (
    <div className="grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)]">
    <SectionNav sections={sections} />
    <ActionForm action={action} className="grid min-w-0 grid-cols-1 gap-6">
      {/* Type d'élément */}
      <Fieldset id="type" legend={tr("Type")} description={tr("Le type détermine les sections affichées ci-dessous.")}>
        <input type="hidden" name="kind" value={kind} />
        <div role="radiogroup" aria-label={tr("Type d'élément")} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {ASSET_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center text-xs font-medium transition-colors",
                kind === k
                  ? "border-accent bg-accent-soft text-h1"
                  : "border-line bg-field text-body hover:border-line-strong hover:text-h1",
              )}
            >
              <KindIcon kind={k} size={20} className={kind === k ? "text-accent-text" : "text-meta"} />
              {tr(ASSET_KIND_META[k].label)}
            </button>
          ))}
        </div>
      </Fieldset>

      {/* Identité */}
      <Fieldset id="identite" legend={tr("Identité")} description={tr("Nom affiché dans Midnights Management et nom d'hôte réel de la machine.")}>
        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label={tr("Nom d'affichage")}
            name="display_name"
            defaultValue={asset?.display_name}
            placeholder={tr("Serveur principal")}
            required
            hint={tr("Libellé lisible utilisé partout dans l'application")}
          />
          <TextField
            label={tr("Nom d'hôte")}
            name="hostname"
            defaultValue={asset?.hostname}
            placeholder="pve-01"
            className="font-mono"
            hint={tr("hostname / FQDN (sert aussi à rapprocher le monitoring)")}
            autoCapitalize="off"
            spellCheck={false}
          />
          <SelectField
            label={tr("État")}
            name="status"
            defaultValue={asset?.status ?? "online"}
            hint={tr("Avec une IP, En ligne / Hors ligne suit le ping (chaque minute). Maintenance, Planifié et Retiré restent manuels.")}
            options={ASSET_STATUSES.map((s) => ({ value: s, label: tr(ASSET_STATUS_META[s].label) }))}
          />
          <TextField label={tr("Rôle")} name="role" defaultValue={asset?.role} placeholder={tr("Hyperviseur, NAS, reverse proxy…")} />
          <SelectField
            label={isDocker ? tr("Hôte Docker") : isGuest ? tr("Nœud hôte") : tr("Hébergé par / rattaché à")}
            name="parent_id"
            defaultValue={asset?.parent_id ?? defaultParent ?? ""}
            onChange={(e) => net.fromHost(parents.find((p) => String(p.id) === e.target.value))}
            placeholder={tr("— Aucun —")}
            options={parents
              .filter((p) => p.id !== asset?.id)
              .map((p) => ({ value: p.id, label: `${p.display_name} · ${tr(ASSET_KIND_META[p.kind].label)}` }))}
          />
          <TextField label={tr("Emplacement")} name="location" defaultValue={asset?.location} placeholder={tr("Baie 1 · U3, bureau…")} />
          <TagInput label={tr("Tags")} name="tags" defaultValue={asset?.tags} suggestions={tags} className="md:col-span-2" />
          <TextAreaField
            label={tr("Description")}
            name="description"
            defaultValue={asset?.description}
            rows={3}
            className="md:col-span-2"
          />
        </div>
      </Fieldset>

      {/* Réseau */}
      <Fieldset id="reseau" legend={tr("Réseau")} description={tr("Adresse principale, enregistrée automatiquement dans l'IPAM.")}>
        <div className="grid gap-5 md:grid-cols-3">
          <NetworkFields net={net} subnets={subnets} assetId={asset?.id} />

          <TextField
            label={tr("Adresse MAC")}
            name="primary_mac"
            value={mac}
            onChange={(e) => setMac(e.target.value)}
            liveError={tr(macError(mac))}
            placeholder="aa:bb:cc:dd:ee:ff"
            className="font-mono"
            spellCheck={false}
          />
          <TextField
            label={tr("URL d'administration")}
            name="management_url"
            defaultValue={asset?.management_url}
            placeholder="https://192.168.10.10:8006"
            hint={tr("Interface web, iDRAC/iLO/IPMI…")}
            className="md:col-span-3"
          />
        </div>
      </Fieldset>

      {/* Système */}
      <Fieldset id="systeme" legend={tr("Système")}>
        <div className="grid gap-5 md:grid-cols-2">
          <TextField label={tr("Système d'exploitation")} name="os" defaultValue={asset?.os} placeholder={tr("Proxmox VE, Debian, TrueNAS…")} />
          <TextField label={tr("Version")} name="os_version" defaultValue={asset?.os_version} placeholder="9.0, 12 (bookworm)…" />
        </div>
      </Fieldset>

      {/* Matériel physique */}
      <div hidden={!isPhysical}>
        <Fieldset id="materiel" legend={tr("Configuration matérielle")} description={tr("Châssis, processeur, mémoire et consommation.")}>
          <div className="grid gap-5 md:grid-cols-3">
            <TextField label={tr("Fabricant")} name="manufacturer" defaultValue={asset?.manufacturer} placeholder={tr("Dell, Lenovo, Minisforum…")} />
            <TextField label={tr("Modèle")} name="model" defaultValue={asset?.model} placeholder="OptiPlex 7060 Micro" />
            <TextField label={tr("N° de série")} name="serial_number" defaultValue={asset?.serial_number} className="font-mono" />
            <TextField
              label={tr("Processeur")}
              name="cpu_model"
              defaultValue={asset?.cpu_model}
              placeholder={tr("Intel Core i5-8500T")}
              className="md:col-span-3"
            />
            <TextField label={tr("Sockets")} name="cpu_sockets" type="number" min={1} defaultValue={asset?.cpu_sockets ?? ""} />
            <TextField label={tr("Threads")} name="cpu_threads" type="number" min={1} defaultValue={asset?.cpu_threads ?? ""} />
            <SelectField
              label={tr("Type de mémoire")}
              name="ram_type"
              defaultValue={asset?.ram_type ?? ""}
              options={RAM_TYPES.filter(Boolean).map((r) => ({ value: r, label: r }))}
              placeholder="—"
            />
            <TextField label={tr("Carte graphique / accélérateur")} name="gpu" defaultValue={asset?.gpu} placeholder={tr("Intel UHD 630, Coral TPU…")} className="md:col-span-2" />
            <TextField label={tr("Consommation (W)")} name="power_watts" type="number" min={0} defaultValue={asset?.power_watts ?? ""} />
          </div>
        </Fieldset>
      </div>

      {/* Ressources (tous sauf Docker) */}
      <div hidden={isDocker}>
        <Fieldset
          id="ressources"
          legend={isGuest ? tr("Ressources allouées") : tr("Ressources")}
          description={isGuest ? tr("vCPU, mémoire et disques virtuels.") : tr("Cœurs, mémoire et stockage.")}
        >
          <div className="grid gap-5 md:grid-cols-2">
            <TextField
              label={isGuest ? "vCPU" : tr("Cœurs CPU")}
              name="cpu_cores"
              type="number"
              min={1}
              defaultValue={asset?.cpu_cores ?? ""}
            />
            <TextField label={tr("Mémoire (Go)")} name="ram_gb" type="number" min={0} step="0.5" defaultValue={asset?.ram_gb ?? ""} />
          </div>

          <input type="hidden" name="disks" value={JSON.stringify(disks)} />
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-h1">
                {tr("Stockage ")}<span className="ml-2 font-mono text-xs text-meta">{disks.length ? tr("total {size}", { size: formatGb(totalDisk, tr.locale) }) : ""}</span>
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setDisks([...disks, { name: "", type: isGuest ? "virtual" : "nvme", capacity_gb: null, usage: "" }])}
              >
                {tr("Ajouter un disque")}</Button>
            </div>
            {disks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-meta">{tr("Aucun disque renseigné.")}</p>
            ) : (
              <ul className="grid gap-2">
                {disks.map((d, i) => (
                  <li key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line-subtle bg-page p-2 sm:grid-cols-[1fr_9rem_8rem_1fr_auto]">
                    <input
                      aria-label={tr("Nom du disque")}
                      className={inputClass}
                      placeholder="nvme0n1 / Samsung 980"
                      value={d.name}
                      onChange={(e) => setDisks(disks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <select
                      aria-label={tr("Type de disque")}
                      className={inputClass}
                      value={d.type}
                      onChange={(e) => setDisks(disks.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                    >
                      {DISK_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {DISK_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={tr("Capacité en Go")}
                      className={inputClass}
                      type="number"
                      min={0}
                      placeholder={tr("Go")}
                      value={d.capacity_gb ?? ""}
                      onChange={(e) =>
                        setDisks(
                          disks.map((x, j) => (j === i ? { ...x, capacity_gb: e.target.value === "" ? null : Number(e.target.value) } : x)),
                        )
                      }
                    />
                    <input
                      aria-label={tr("Usage")}
                      className={inputClass}
                      placeholder={tr("Système, ZFS mirror, données…")}
                      value={d.usage}
                      onChange={(e) => setDisks(disks.map((x, j) => (j === i ? { ...x, usage: e.target.value } : x)))}
                    />
                    <Button
                      variant="subtle"
                      size="icon"
                      aria-label={tr("Retirer ce disque")}
                      onClick={() => setDisks(disks.filter((_, j) => j !== i))}
                      icon={<Trash2 size={15} />}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <input type="hidden" name="nics" value={JSON.stringify(nics)} />
          <div className="mt-6" hidden={!isPhysical}>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-h1">{tr("Interfaces réseau")}</p>
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setNics([...nics, { name: "", mac: "", speed: "1 Gb/s" }])}
              >
                {tr("Ajouter une interface")}</Button>
            </div>
            {nics.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-meta">{tr("Aucune interface renseignée.")}</p>
            ) : (
              <ul className="grid gap-2">
                {nics.map((n, i) => (
                  <li key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line-subtle bg-page p-2 sm:grid-cols-[1fr_1fr_9rem_auto]">
                    <input
                      aria-label={tr("Nom de l'interface")}
                      className={inputClass}
                      placeholder="enp1s0"
                      value={n.name}
                      onChange={(e) => setNics(nics.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <input
                      aria-label={tr("Adresse MAC")}
                      aria-invalid={macError(n.mac) ? true : undefined}
                      title={tr(macError(n.mac)) || undefined}
                      className={cn(inputClass, "font-mono")}
                      placeholder="aa:bb:cc:dd:ee:ff"
                      value={n.mac}
                      onChange={(e) => setNics(nics.map((x, j) => (j === i ? { ...x, mac: e.target.value } : x)))}
                    />
                    <select
                      aria-label={tr("Débit")}
                      className={inputClass}
                      value={n.speed}
                      onChange={(e) => setNics(nics.map((x, j) => (j === i ? { ...x, speed: e.target.value } : x)))}
                    >
                      {["100 Mb/s", "1 Gb/s", "2.5 Gb/s", "5 Gb/s", "10 Gb/s", "25 Gb/s", "40 Gb/s", "Wi-Fi"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                    <Button
                      variant="subtle"
                      size="icon"
                      aria-label={tr("Retirer cette interface")}
                      onClick={() => setNics(nics.filter((_, j) => j !== i))}
                      icon={<Trash2 size={15} />}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Fieldset>
      </div>

      {/* Proxmox */}
      <div hidden={!isGuest}>
        <Fieldset id="proxmox" legend={tr("Proxmox")} description={tr("Lien facultatif vers l'invité Proxmox, pour ouvrir sa console depuis l'inventaire.")}>
          <div className="grid gap-5 md:grid-cols-3">
            <SelectField
              label={tr("Intégration")}
              name="proxmox_integration_id"
              defaultValue={asset?.proxmox_integration_id ?? ""}
              placeholder={tr("— Aucune —")}
              options={proxmox.map((p) => ({ value: p.id, label: p.name }))}
            />
            <TextField label={tr("Nœud")} name="proxmox_node" defaultValue={asset?.proxmox_node} placeholder="pve-01" className="font-mono" />
            <TextField label="VMID" name="proxmox_vmid" type="number" min={100} defaultValue={asset?.proxmox_vmid ?? ""} className="font-mono" />
          </div>
        </Fieldset>
      </div>

      {/* Docker */}
      <div hidden={!isDocker}>
        <Fieldset id="docker" legend={tr("Docker")}>
          <div className="grid gap-5 md:grid-cols-2">
            <TextField label={tr("Image")} name="docker_image" defaultValue={asset?.docker_image} placeholder="ghcr.io/home-assistant/home-assistant:stable" className="font-mono md:col-span-2" />
            <TextField label={tr("Ports exposés")} name="docker_ports" defaultValue={asset?.docker_ports} placeholder="8123:8123, 443:443" className="font-mono" />
            <TextField label={tr("Projet Compose / stack")} name="docker_compose" defaultValue={asset?.docker_compose} placeholder="domotique" />
          </div>
        </Fieldset>
      </div>

      <Fieldset id="notes" legend={tr("Notes")}>
        <TextAreaField label={tr("Notes libres")} name="notes" defaultValue={asset?.notes} rows={6} placeholder={tr("Procédures, identifiants de rangement, historique…")} />
      </Fieldset>

      <div className={FORM_ACTIONS_CLASS}>
        <ButtonLink href={asset ? `/inventaire/${asset.id}` : "/inventaire"} variant="secondary">
          {tr("Annuler")}</ButtonLink>
        <SubmitButton>{asset ? tr("Enregistrer") : tr("Ajouter à l'inventaire")}</SubmitButton>
      </div>
    </ActionForm>
    </div>
  );
}
