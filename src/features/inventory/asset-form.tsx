"use client";

import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { saveAssetAction } from "@/actions/inventory";
import { nextFreeIpAction } from "@/actions/network";
import { Button, ButtonLink } from "@/components/ui/button";
import { ActionForm, Field, Fieldset, inputClass, SelectField, SubmitButton, TextAreaField, TextField } from "@/components/ui/form";
import { KindIcon } from "@/components/kind-icon";
import { IpHint } from "@/features/network/ip-hint";
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

type SubnetOption = { id: number; name: string; cidr: string; vlan_number: number | null };

export function AssetForm({
  asset,
  defaultKind = "physical",
  defaultParent,
  parents,
  subnets,
  proxmox,
}: {
  asset?: Asset;
  defaultKind?: AssetKind;
  defaultParent?: number;
  parents: AssetOption[];
  subnets: SubnetOption[];
  proxmox: { id: number; name: string }[];
}) {
  const [kind, setKind] = useState<AssetKind>(asset?.kind ?? defaultKind);
  const [disks, setDisks] = useState<Disk[]>(asset?.disks ?? []);
  const [nics, setNics] = useState<Nic[]>(asset?.nics ?? []);
  const [subnetId, setSubnetId] = useState<string>(asset?.subnet_id ? String(asset.subnet_id) : "");
  const [ip, setIp] = useState(asset?.primary_ip ?? "");
  const [suggesting, startSuggest] = useTransition();

  const isPhysical = kind === "physical" || kind === "network" || kind === "other";
  const isGuest = kind === "vm" || kind === "lxc";
  const isDocker = kind === "docker";
  const totalDisk = disks.reduce((n, d) => n + (Number(d.capacity_gb) || 0), 0);

  const action = saveAssetAction.bind(null, asset?.id ?? null);

  return (
    <ActionForm action={action} className="grid grid-cols-1 gap-6">
      {/* Type d'élément */}
      <Fieldset legend="Type" description="Le type détermine les sections affichées ci-dessous.">
        <input type="hidden" name="kind" value={kind} />
        <div role="radiogroup" aria-label="Type d'élément" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
              {ASSET_KIND_META[k].label}
            </button>
          ))}
        </div>
      </Fieldset>

      {/* Identité */}
      <Fieldset legend="Identité" description="Nom affiché dans Homelab Management et nom d'hôte réel de la machine.">
        <div className="grid gap-5 md:grid-cols-2">
          <TextField
            label="Nom d'affichage"
            name="display_name"
            defaultValue={asset?.display_name}
            placeholder="Serveur principal"
            required
            hint="Libellé lisible utilisé partout dans l'application"
          />
          <TextField
            label="Nom d'hôte"
            name="hostname"
            defaultValue={asset?.hostname}
            placeholder="pve-01"
            className="font-mono"
            hint="hostname / FQDN (sert aussi à rapprocher le monitoring)"
            autoCapitalize="off"
            spellCheck={false}
          />
          <SelectField
            label="État"
            name="status"
            defaultValue={asset?.status ?? "online"}
            options={ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_META[s].label }))}
          />
          <TextField label="Rôle" name="role" defaultValue={asset?.role} placeholder="Hyperviseur, NAS, reverse proxy…" />
          <SelectField
            label={isDocker ? "Hôte Docker" : isGuest ? "Nœud hôte" : "Hébergé par / rattaché à"}
            name="parent_id"
            defaultValue={asset?.parent_id ?? defaultParent ?? ""}
            placeholder="— Aucun —"
            options={parents
              .filter((p) => p.id !== asset?.id)
              .map((p) => ({ value: p.id, label: `${p.display_name} · ${ASSET_KIND_META[p.kind].label}` }))}
          />
          <TextField label="Emplacement" name="location" defaultValue={asset?.location} placeholder="Baie 1 · U3, bureau…" />
          <TextField
            label="Tags"
            name="tags"
            defaultValue={asset?.tags.join(", ")}
            placeholder="prod, dns, critique"
            hint="Séparés par des virgules"
            className="md:col-span-2"
          />
          <TextAreaField
            label="Description"
            name="description"
            defaultValue={asset?.description}
            rows={3}
            className="md:col-span-2"
          />
        </div>
      </Fieldset>

      {/* Réseau */}
      <Fieldset legend="Réseau" description="Adresse principale, enregistrée automatiquement dans l'IPAM.">
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Sous-réseau" name="primary_subnet_id">
            {(p) => (
              <select {...p} className={inputClass} value={subnetId} onChange={(e) => setSubnetId(e.target.value)}>
                <option value="">— Détection automatique —</option>
                {subnets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.cidr}
                    {s.vlan_number ? ` · VLAN ${s.vlan_number}` : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Adresse IP" name="primary_ip">
            {(p) => (
              <>
              <div className="flex gap-2">
                <input
                  {...p}
                  className={cn(inputClass, "font-mono")}
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.168.10.20"
                  inputMode="decimal"
                />
                <Button
                  variant="secondary"
                  size="icon"
                  className="shrink-0"
                  disabled={!subnetId || suggesting}
                  title="Proposer la prochaine IP libre"
                  aria-label="Proposer la prochaine IP libre"
                  onClick={() =>
                    startSuggest(async () => {
                      const next = await nextFreeIpAction(Number(subnetId));
                      if (next) setIp(next);
                    })
                  }
                  icon={<Sparkles size={16} />}
                />
              </div>
              <IpHint address={ip} subnetId={subnetId ? Number(subnetId) : null} assetId={asset?.id ?? null} />
              </>
            )}
          </Field>

          <TextField
            label="Adresse MAC"
            name="primary_mac"
            defaultValue={asset?.primary_mac ?? ""}
            placeholder="aa:bb:cc:dd:ee:ff"
            className="font-mono"
            spellCheck={false}
          />
          <TextField
            label="URL d'administration"
            name="management_url"
            defaultValue={asset?.management_url}
            placeholder="https://192.168.10.10:8006"
            hint="Interface web, iDRAC/iLO/IPMI…"
            className="md:col-span-3"
          />
        </div>
      </Fieldset>

      {/* Système */}
      <Fieldset legend="Système">
        <div className="grid gap-5 md:grid-cols-2">
          <TextField label="Système d'exploitation" name="os" defaultValue={asset?.os} placeholder="Proxmox VE, Debian, TrueNAS…" />
          <TextField label="Version" name="os_version" defaultValue={asset?.os_version} placeholder="9.0, 12 (bookworm)…" />
        </div>
      </Fieldset>

      {/* Matériel physique */}
      <div hidden={!isPhysical}>
        <Fieldset legend="Configuration matérielle" description="Châssis, processeur, mémoire et consommation.">
          <div className="grid gap-5 md:grid-cols-3">
            <TextField label="Fabricant" name="manufacturer" defaultValue={asset?.manufacturer} placeholder="Dell, Lenovo, Minisforum…" />
            <TextField label="Modèle" name="model" defaultValue={asset?.model} placeholder="OptiPlex 7060 Micro" />
            <TextField label="N° de série" name="serial_number" defaultValue={asset?.serial_number} className="font-mono" />
            <TextField
              label="Processeur"
              name="cpu_model"
              defaultValue={asset?.cpu_model}
              placeholder="Intel Core i5-8500T"
              className="md:col-span-3"
            />
            <TextField label="Sockets" name="cpu_sockets" type="number" min={1} defaultValue={asset?.cpu_sockets ?? ""} />
            <TextField label="Threads" name="cpu_threads" type="number" min={1} defaultValue={asset?.cpu_threads ?? ""} />
            <SelectField
              label="Type de mémoire"
              name="ram_type"
              defaultValue={asset?.ram_type ?? ""}
              options={RAM_TYPES.filter(Boolean).map((r) => ({ value: r, label: r }))}
              placeholder="—"
            />
            <TextField label="Carte graphique / accélérateur" name="gpu" defaultValue={asset?.gpu} placeholder="Intel UHD 630, Coral TPU…" className="md:col-span-2" />
            <TextField label="Consommation (W)" name="power_watts" type="number" min={0} defaultValue={asset?.power_watts ?? ""} />
          </div>
        </Fieldset>
      </div>

      {/* Ressources (tous sauf Docker) */}
      <div hidden={isDocker}>
        <Fieldset
          legend={isGuest ? "Ressources allouées" : "Ressources"}
          description={isGuest ? "vCPU, mémoire et disques virtuels." : "Cœurs, mémoire et stockage."}
        >
          <div className="grid gap-5 md:grid-cols-2">
            <TextField
              label={isGuest ? "vCPU" : "Cœurs CPU"}
              name="cpu_cores"
              type="number"
              min={1}
              defaultValue={asset?.cpu_cores ?? ""}
            />
            <TextField label="Mémoire (Go)" name="ram_gb" type="number" min={0} step="0.5" defaultValue={asset?.ram_gb ?? ""} />
          </div>

          <input type="hidden" name="disks" value={JSON.stringify(disks)} />
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-h1">
                Stockage <span className="ml-2 font-mono text-xs text-meta">{disks.length ? `total ${formatGb(totalDisk)}` : ""}</span>
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setDisks([...disks, { name: "", type: isGuest ? "virtual" : "nvme", capacity_gb: null, usage: "" }])}
              >
                Ajouter un disque
              </Button>
            </div>
            {disks.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-meta">Aucun disque renseigné.</p>
            ) : (
              <ul className="grid gap-2">
                {disks.map((d, i) => (
                  <li key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line-subtle bg-page p-2 sm:grid-cols-[1fr_9rem_8rem_1fr_auto]">
                    <input
                      aria-label="Nom du disque"
                      className={inputClass}
                      placeholder="nvme0n1 / Samsung 980"
                      value={d.name}
                      onChange={(e) => setDisks(disks.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <select
                      aria-label="Type de disque"
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
                      aria-label="Capacité en Go"
                      className={inputClass}
                      type="number"
                      min={0}
                      placeholder="Go"
                      value={d.capacity_gb ?? ""}
                      onChange={(e) =>
                        setDisks(
                          disks.map((x, j) => (j === i ? { ...x, capacity_gb: e.target.value === "" ? null : Number(e.target.value) } : x)),
                        )
                      }
                    />
                    <input
                      aria-label="Usage"
                      className={inputClass}
                      placeholder="Système, ZFS mirror, données…"
                      value={d.usage}
                      onChange={(e) => setDisks(disks.map((x, j) => (j === i ? { ...x, usage: e.target.value } : x)))}
                    />
                    <Button
                      variant="subtle"
                      size="icon"
                      aria-label="Retirer ce disque"
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
              <p className="text-sm font-medium text-h1">Interfaces réseau</p>
              <Button
                variant="ghost"
                size="sm"
                icon={<Plus size={14} />}
                onClick={() => setNics([...nics, { name: "", mac: "", speed: "1 Gb/s" }])}
              >
                Ajouter une interface
              </Button>
            </div>
            {nics.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-meta">Aucune interface renseignée.</p>
            ) : (
              <ul className="grid gap-2">
                {nics.map((n, i) => (
                  <li key={i} className="grid grid-cols-2 gap-2 rounded-xl border border-line-subtle bg-page p-2 sm:grid-cols-[1fr_1fr_9rem_auto]">
                    <input
                      aria-label="Nom de l'interface"
                      className={inputClass}
                      placeholder="enp1s0"
                      value={n.name}
                      onChange={(e) => setNics(nics.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <input
                      aria-label="Adresse MAC"
                      className={cn(inputClass, "font-mono")}
                      placeholder="aa:bb:cc:dd:ee:ff"
                      value={n.mac}
                      onChange={(e) => setNics(nics.map((x, j) => (j === i ? { ...x, mac: e.target.value } : x)))}
                    />
                    <select
                      aria-label="Débit"
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
                      aria-label="Retirer cette interface"
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
        <Fieldset legend="Proxmox" description="Lien avec l'invité Proxmox (rempli automatiquement par la synchronisation).">
          <div className="grid gap-5 md:grid-cols-3">
            <SelectField
              label="Intégration"
              name="proxmox_integration_id"
              defaultValue={asset?.proxmox_integration_id ?? ""}
              placeholder="— Aucune —"
              options={proxmox.map((p) => ({ value: p.id, label: p.name }))}
            />
            <TextField label="Nœud" name="proxmox_node" defaultValue={asset?.proxmox_node} placeholder="pve-01" className="font-mono" />
            <TextField label="VMID" name="proxmox_vmid" type="number" min={100} defaultValue={asset?.proxmox_vmid ?? ""} className="font-mono" />
          </div>
        </Fieldset>
      </div>

      {/* Docker */}
      <div hidden={!isDocker}>
        <Fieldset legend="Docker">
          <div className="grid gap-5 md:grid-cols-2">
            <TextField label="Image" name="docker_image" defaultValue={asset?.docker_image} placeholder="ghcr.io/home-assistant/home-assistant:stable" className="font-mono md:col-span-2" />
            <TextField label="Ports exposés" name="docker_ports" defaultValue={asset?.docker_ports} placeholder="8123:8123, 443:443" className="font-mono" />
            <TextField label="Projet Compose / stack" name="docker_compose" defaultValue={asset?.docker_compose} placeholder="domotique" />
          </div>
        </Fieldset>
      </div>

      <Fieldset legend="Notes">
        <TextAreaField label="Notes libres" name="notes" defaultValue={asset?.notes} rows={6} placeholder="Procédures, identifiants de rangement, historique…" />
      </Fieldset>

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-10 flex justify-end xl:bottom-4 xl:mr-16 2xl:mr-0 gap-3 rounded-full border border-line bg-page/90 p-2 backdrop-blur">
        <ButtonLink href={asset ? `/inventaire/${asset.id}` : "/inventaire"} variant="secondary">
          Annuler
        </ButtonLink>
        <SubmitButton>{asset ? "Enregistrer" : "Ajouter à l'inventaire"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
