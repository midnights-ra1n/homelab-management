
import { ArrowDown, ArrowUp, Pencil, Plus, ShieldHalf } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteRuleAction, moveRuleAction, saveRuleAction, setDefaultPolicyAction, toggleRuleAction } from "@/actions/network";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDialog } from "@/components/ui/form-dialog";
import { Field, inputClass, SelectField, Switch, TextField } from "@/components/ui/form";
import { FW_PROTOCOLS, FW_PROTOCOL_LABEL, FW_TARGETS, FW_TARGET_LABEL, type FwTarget } from "@/lib/constants";
import type { FirewallRule } from "@/lib/data/firewall";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import type { Translate } from "@/i18n/translate";

export type FwOptions = {
  vlans: { id: number; label: string }[];
  subnets: { id: number; label: string }[];
  assets: { id: number; label: string }[];
  tunnels: { id: number; label: string }[];
};

export function targetLabel(type: FwTarget, value: string, o: FwOptions, tr: Translate) {
  const find = (list: { id: number; label: string }[]) => list.find((x) => String(x.id) === value)?.label ?? tr("#{id} (supprimé)", { id: value });
  switch (type) {
    case "any":
      return tr("N'importe où");
    case "internet":
      return "Internet";
    case "cidr":
      return value;
    case "vlan":
      return find(o.vlans);
    case "subnet":
      return find(o.subnets);
    case "asset":
      return find(o.assets);
    case "vpn":
      return find(o.tunnels);
  }
}

export function FirewallSection({ rules, policy, options }: { rules: FirewallRule[]; policy: "allow" | "deny"; options: FwOptions }) {
  const tr = useT();
  const [current, setCurrent] = useState(policy);
  const [, start] = useTransition();
  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-line-subtle bg-box p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="font-medium text-h1">{tr("Politique par défaut")}</p>
          <p className="mt-1 text-sm text-body">
            {tr("Appliquée au trafic routé (entre VLAN, vers un VPN ou Internet) quand aucune règle ne correspond. Le trafic au sein d'un même sous-réseau ne passe pas par le pare-feu.")}</p>
        </div>
        <div role="radiogroup" aria-label={tr("Politique par défaut")} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-page p-1">
          {(["allow", "deny"] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={current === p}
              onClick={() =>
                start(async () => {
                  setCurrent(p);
                  await setDefaultPolicyAction(p);
                })
              }
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                current === p ? (p === "allow" ? "bg-green text-on-accent" : "bg-red text-on-accent") : "text-body hover:text-h1",
              )}
            >
              {p === "allow" ? tr("Tout autoriser") : tr("Tout bloquer")}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-meta">{tr("Évaluées de haut en bas : la première règle qui correspond s'applique.")}</p>
        <RuleDialog options={options} />
      </div>

      {rules.length === 0 ? (
        <EmptyState icon={<ShieldHalf size={22} />} title={tr("Aucune règle")} action={<RuleDialog options={options} />}>
          {tr("Exemple : bloquer le VLAN IoT vers le VLAN Serveurs, mais autoriser IoT → Home Assistant en TCP 8123.")}</EmptyState>
      ) : (
        <ol className="grid gap-2">
          {rules.map((r, i) => (
            <li
              key={r.id}
              className={cn(
                "flex flex-col gap-3 rounded-2xl border border-line-subtle bg-box p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5",
                !r.enabled && "opacity-55",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 text-center font-mono text-xs text-meta">{i + 1}</span>
                <Badge tone={r.action === "allow" ? "green" : "red"} className="min-w-20 justify-center">
                  {r.action === "allow" ? tr("Autoriser") : tr("Bloquer")}
                </Badge>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-h1">
                  <span className="font-medium">{targetLabel(r.src_type, r.src_value, options, tr)}</span>
                  <span className="mx-2 text-meta">→</span>
                  <span className="font-medium">{targetLabel(r.dst_type, r.dst_value, options, tr)}</span>
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-meta">
                  {FW_PROTOCOL_LABEL[r.protocol]}
                  {r.ports ? ` · ports ${r.ports}` : r.protocol !== "icmp" && r.protocol !== "any" ? tr(" · tous les ports") : ""}
                  {r.name ? ` · ${r.name}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 self-end sm:self-auto">
                <Button variant="subtle" size="icon-sm" aria-label={tr("Monter")} disabled={i === 0} onClick={() => moveRuleAction(r.id, -1)} icon={<ArrowUp size={14} />} />
                <Button
                  variant="subtle"
                  size="icon-sm"
                  aria-label={tr("Descendre")}
                  disabled={i === rules.length - 1}
                  onClick={() => moveRuleAction(r.id, 1)}
                  icon={<ArrowDown size={14} />}
                />
                <Button variant="subtle" size="sm" onClick={() => toggleRuleAction(r.id)}>
                  {r.enabled ? tr("Désactiver") : tr("Activer")}
                </Button>
                <RuleDialog rule={r} options={options} />
                <ConfirmButton action={() => deleteRuleAction(r.id)} message={tr("Supprimer cette règle ?")} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TargetPicker({ prefix, label, rule, options }: { prefix: "src" | "dst"; label: string; rule?: FirewallRule; options: FwOptions }) {
  const tr = useT();
  const [type, setType] = useState<FwTarget>(rule?.[`${prefix}_type`] ?? "any");
  const value = rule?.[`${prefix}_value`] ?? "";
  const list =
    type === "vlan" ? options.vlans : type === "subnet" ? options.subnets : type === "asset" ? options.assets : type === "vpn" ? options.tunnels : null;
  return (
    <div className="grid gap-3 rounded-2xl border border-line-subtle bg-page p-4">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-meta">{label}</p>
      <Field label={tr("Type")} name={`${prefix}_type`}>
        {(p) => (
          <select {...p} className={inputClass} value={type} onChange={(e) => setType(e.target.value as FwTarget)}>
            {FW_TARGETS.map((t) => (
              <option key={t} value={t}>
                {FW_TARGET_LABEL[t]}
              </option>
            ))}
          </select>
        )}
      </Field>
      {list && (
        <SelectField
          key={type}
          label={FW_TARGET_LABEL[type]}
          name={`${prefix}_value`}
          defaultValue={rule?.[`${prefix}_type`] === type ? value : ""}
          placeholder="— Choisir —"
          options={list.map((x) => ({ value: x.id, label: x.label }))}
        />
      )}
      {type === "cidr" && (
        <TextField key="cidr" label="CIDR" name={`${prefix}_value`} defaultValue={rule?.[`${prefix}_type`] === "cidr" ? value : ""} placeholder="10.0.0.0/8" className="font-mono" />
      )}
      {(type === "any" || type === "internet") && <input type="hidden" name={`${prefix}_value`} value="" />}
    </div>
  );
}

function RuleDialog({ rule, options }: { rule?: FirewallRule; options: FwOptions }) {
  const tr = useT();
  const [protocol, setProtocol] = useState(rule?.protocol ?? "tcp");
  return (
    <FormDialog
      title={rule ? tr("Modifier la règle") : tr("Nouvelle règle")}
      action={saveRuleAction.bind(null, rule?.id ?? null)}
      trigger={rule ? undefined : tr("Règle")}
      triggerVariant={rule ? "subtle" : "primary"}
      triggerSize={rule ? "icon-sm" : "md"}
      triggerIcon={rule ? <Pencil size={14} /> : <Plus size={16} />}
      triggerLabel={rule ? tr("Modifier la règle") : tr("Nouvelle règle")}
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
        <SelectField
          label={tr("Action")}
          name="action"
          defaultValue={rule?.action ?? "deny"}
          options={[
            { value: "deny", label: tr("Bloquer") },
            { value: "allow", label: tr("Autoriser") },
          ]}
        />
        <TextField label={tr("Nom")} name="name" defaultValue={rule?.name} placeholder={tr("IoT ne voit pas les serveurs")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TargetPicker prefix="src" label={tr("Source")} rule={rule} options={options} />
        <TargetPicker prefix="dst" label={tr("Destination")} rule={rule} options={options} />
      </div>
      <div className="grid gap-5 sm:grid-cols-[12rem_1fr]">
        <Field label={tr("Protocole")} name="protocol">
          {(p) => (
            <select {...p} className={inputClass} value={protocol} onChange={(e) => setProtocol(e.target.value as typeof protocol)}>
              {FW_PROTOCOLS.map((x) => (
                <option key={x} value={x}>
                  {FW_PROTOCOL_LABEL[x]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <TextField
          label={tr("Ports")}
          name="ports"
          defaultValue={rule?.ports}
          placeholder="22,80,443,8000-8100"
          hint={protocol === "icmp" ? tr("Sans objet pour ICMP") : tr("Vide = tous les ports")}
          disabled={protocol === "icmp"}
          className="font-mono"
        />
      </div>
      <Switch name="enabled" label={tr("Règle active")} defaultChecked={rule ? !!rule.enabled : true} />
    </FormDialog>
  );
}
