import Link from "next/link";
import { Badge, StatusDot, Tag } from "@/components/ui/badge";
import { KindAvatar } from "@/components/kind-icon";
import { ASSET_KIND_META, ASSET_STATUS_META, STATUS_SOURCE_LABEL } from "@/lib/constants";
import type { Asset } from "@/lib/data/assets";
import { formatDateTime, formatGb } from "@/lib/utils";
import { getT } from "@/i18n/server";
import type { Translate } from "@/i18n/translate";

export function resourceSummary(a: Asset, tr: Translate) {
  const parts: string[] = [];
  if (a.cpu_cores) parts.push(`${a.cpu_cores} ${a.kind === "vm" || a.kind === "lxc" ? "vCPU" : tr("cœurs")}`);
  if (a.ram_gb) parts.push(`${+a.ram_gb} ${tr.locale === "en" ? "GB" : "Go"}`);
  const disk = a.disks.reduce((n, d) => n + (d.capacity_gb ?? 0), 0);
  if (disk) parts.push(formatGb(disk, tr.locale));
  return parts.join(" · ");
}

export async function AssetTable({ assets }: { assets: Asset[] }) {
  const tr = await getT();
  return (
    <>
      <AssetCards assets={assets} />
      <div className="hidden overflow-hidden rounded-2xl border border-line-subtle bg-box md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line-subtle font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
              <th className="px-5 py-3 font-medium">{tr("Nom")}</th>
              <th className="px-3 py-3 font-medium">{tr("État")}</th>
              <th className="px-3 py-3 font-medium">{tr("Adresse")}</th>
              <th className="px-3 py-3 font-medium">{tr("Hôte")}</th>
              <th className="px-3 py-3 font-medium">{tr("Ressources")}</th>
              <th className="px-5 py-3 font-medium">{tr("Tags")}</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const status = ASSET_STATUS_META[a.status];
              return (
                <tr key={a.id} className="group border-b border-line-subtle last:border-0 transition-colors hover:bg-elevated/50">
                  <td className="px-5 py-3">
                    <Link href={`/inventaire/${a.id}`} className="flex items-center gap-3">
                      <KindAvatar kind={a.kind} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-h1 group-hover:text-accent-text">{a.display_name}</span>
                        <span className="block truncate font-mono text-xs text-meta">
                          {a.hostname || tr(ASSET_KIND_META[a.kind].label)}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="inline-flex items-center gap-2 text-body"
                      title={
                        a.status_source && a.status_checked_at
                          ? tr("via {source} · {when}", {
                              source: tr(STATUS_SOURCE_LABEL[a.status_source] ?? a.status_source),
                              when: formatDateTime(a.status_checked_at, tr.locale),
                            })
                          : undefined
                      }
                    >
                      <StatusDot tone={status.tone} ping={a.status === "online"} />
                      {tr(status.label)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {a.primary_ip ? (
                      <span className="block font-mono text-h2">{a.primary_ip}</span>
                    ) : (
                      <span className="text-meta">—</span>
                    )}
                    {a.vlan_number && <span className="font-mono text-xs text-meta">{tr("VLAN ")}{a.vlan_number}</span>}
                  </td>
                  <td className="px-3 py-3 text-body">
                    {a.parent_id ? (
                      <Link href={`/inventaire/${a.parent_id}`} className="hover:text-accent-text">
                        {a.parent_name}
                      </Link>
                    ) : (
                      <span className="text-meta">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-body">{resourceSummary(a, tr) || <span className="text-meta">—</span>}</td>
                  <td className="px-5 py-3">
                    <div className="flex max-w-[16rem] flex-wrap gap-1">
                      {a.tags.slice(0, 4).map((t) => (
                        <Link key={t} href={`/inventaire?tag=${encodeURIComponent(t)}`}>
                          <Tag>{t}</Tag>
                        </Link>
                      ))}
                      {a.tags.length > 4 && <Badge>+{a.tags.length - 4}</Badge>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}

/** Version mobile : cartes tactiles. */
async function AssetCards({ assets }: { assets: Asset[] }) {
  const tr = await getT();
  return (
    <ul className="grid gap-2 md:hidden">
      {assets.map((a) => {
        const status = ASSET_STATUS_META[a.status];
        return (
          <li key={a.id}>
            <Link
              href={`/inventaire/${a.id}`}
              className="flex items-center gap-3 rounded-2xl border border-line-subtle bg-box p-4 transition-transform active:scale-[0.99]"
            >
              <KindAvatar kind={a.kind} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <StatusDot tone={status.tone} ping={a.status === "online"} />
                  <span className="truncate font-medium text-h1">{a.display_name}</span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-meta">
                  {[a.primary_ip, a.hostname, a.parent_name].filter(Boolean).join(" · ") || tr(ASSET_KIND_META[a.kind].label)}
                </span>
              </span>
              {resourceSummary(a, tr) && <span className="hidden shrink-0 font-mono text-xs text-body sm:block">{resourceSummary(a, tr)}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
