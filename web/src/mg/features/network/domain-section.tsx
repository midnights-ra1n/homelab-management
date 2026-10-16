
import Link from "next/link";
import { Globe, Pencil, Plus } from "lucide-react";
import { deleteDomainAction, saveDomainAction } from "@/actions/network";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/form";
import { DOMAIN_EXPOSURES, DOMAIN_EXPOSURE_META } from "@/lib/constants";
import type { Domain } from "@/lib/data/domains";
import { useT } from "@/i18n/client";

type AssetOpt = { id: number; display_name: string };

export function DomainSection({ domains, assets }: { domains: Domain[]; assets: AssetOpt[] }) {
  const tr = useT();
  const pub = domains.filter((d) => d.exposure === "public").length;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-xs text-meta">
          {tr("{total} domaine(s) · {pub} exposé(s) sur Internet", { total: domains.length, pub })}
        </p>
        <DomainDialog assets={assets} />
      </div>
      {domains.length === 0 ? (
        <EmptyState icon={<Globe size={22} />} title={tr("Aucun nom de domaine")} action={<DomainDialog assets={assets} />}>
          {tr("Recense tes sous-domaines : exposés sur Internet ou réservés au LAN, le service vers lequel ils pointent et le reverse proxy qui les sert.")}
        </EmptyState>
      ) : (
        <ul className="grid gap-2">
          {domains.map((d) => {
            const exp = DOMAIN_EXPOSURE_META[d.exposure];
            return (
              <li key={d.id} className="grid gap-3 rounded-2xl border border-line-subtle bg-box p-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <a href={`https://${d.fqdn.replace(/^\*\./, "")}`} target="_blank" rel="noreferrer" className="block truncate font-mono text-h1 hover:text-accent-text">
                    {d.fqdn}
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={exp.tone} dot>
                      {tr(exp.label)}
                    </Badge>
                    {d.notes && <span className="truncate text-xs text-meta">{d.notes}</span>}
                  </div>
                </div>
                <Target label={tr("Service")} id={d.target_asset_id} name={d.target_name} detail={d.upstream || d.target_ip} />
                <Target label={tr("Reverse proxy")} id={d.proxy_asset_id} name={d.proxy_name} detail={d.proxy_ip} />
                <div className="-mr-2 flex justify-end">
                  <DomainDialog domain={d} assets={assets} />
                  <ConfirmButton action={() => deleteDomainAction(d.id)} message={tr("Supprimer le domaine « {name} » ?", { name: d.fqdn })} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Target({ label, id, name, detail }: { label: string; id: number | null; name: string | null; detail: string | null }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">{label}</p>
      {id ? (
        <Link href={`/inventaire/${id}`} className="block truncate text-sm font-medium text-h2 hover:text-accent-text">
          {name}
        </Link>
      ) : (
        <p className="text-sm text-meta">—</p>
      )}
      {detail && <p className="truncate font-mono text-xs text-body">{detail}</p>}
    </div>
  );
}

function DomainDialog({ domain, assets }: { domain?: Domain; assets: AssetOpt[] }) {
  const tr = useT();
  const assetOptions = assets.map((a) => ({ value: a.id, label: a.display_name }));
  return (
    <FormDialog
      title={domain ? tr("Modifier « {name} »", { name: domain.fqdn }) : tr("Nouveau nom de domaine")}
      description={tr("L'adresse du reverse proxy est son IP principale dans l'inventaire.")}
      action={saveDomainAction.bind(null, domain?.id ?? null)}
      trigger={domain ? undefined : tr("Domaine")}
      triggerVariant={domain ? "subtle" : "primary"}
      triggerSize={domain ? "icon-sm" : "md"}
      triggerIcon={domain ? <Pencil size={14} /> : <Plus size={16} />}
      triggerLabel={domain ? tr("Modifier le domaine") : tr("Nouveau nom de domaine")}
    >
      <div className="grid gap-5 sm:grid-cols-[1fr_12rem]">
        <TextField label={tr("Domaine")} name="fqdn" defaultValue={domain?.fqdn} placeholder="jellyfin.example.fr" required className="font-mono" />
        <SelectField
          label={tr("Exposition")}
          name="exposure"
          defaultValue={domain?.exposure ?? "lan"}
          options={DOMAIN_EXPOSURES.map((e) => ({ value: e, label: tr(DOMAIN_EXPOSURE_META[e].label) }))}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label={tr("Reverse proxy")} name="proxy_asset_id" defaultValue={domain?.proxy_asset_id ?? ""} placeholder="— Choisir —" options={assetOptions} />
        <SelectField label={tr("Service ciblé")} name="target_asset_id" defaultValue={domain?.target_asset_id ?? ""} placeholder="— Choisir —" options={assetOptions} />
      </div>
      <TextField label={tr("URL interne du service")} name="upstream" defaultValue={domain?.upstream} placeholder="http://10.0.10.5:8096" className="font-mono" />
      <TextAreaField label={tr("Notes")} name="notes" defaultValue={domain?.notes} rows={2} />
    </FormDialog>
  );
}
