import Link from "next/link";
import { Badge, StatusDot, Tag } from "@/components/ui/badge";
import { KindAvatar } from "@/components/kind-icon";
import { ASSET_KIND_META, ASSET_STATUS_META } from "@/lib/constants";
import type { Asset } from "@/lib/data/assets";
import { formatGb } from "@/lib/utils";

export function resourceSummary(a: Asset) {
  const parts: string[] = [];
  if (a.cpu_cores) parts.push(`${a.cpu_cores} ${a.kind === "vm" || a.kind === "lxc" ? "vCPU" : "cœurs"}`);
  if (a.ram_gb) parts.push(`${+a.ram_gb} Go`);
  const disk = a.disks.reduce((n, d) => n + (d.capacity_gb ?? 0), 0);
  if (disk) parts.push(formatGb(disk));
  return parts.join(" · ");
}

export function AssetTable({ assets }: { assets: Asset[] }) {
  return (
    <>
      <AssetCards assets={assets} />
      <div className="hidden overflow-hidden rounded-2xl border border-line-subtle bg-box md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line-subtle font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
              <th className="px-5 py-3 font-medium">Nom</th>
              <th className="px-3 py-3 font-medium">État</th>
              <th className="px-3 py-3 font-medium">Adresse</th>
              <th className="px-3 py-3 font-medium">Hôte</th>
              <th className="px-3 py-3 font-medium">Ressources</th>
              <th className="px-5 py-3 font-medium">Tags</th>
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
                          {a.hostname || ASSET_KIND_META[a.kind].label}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-2 text-body">
                      <StatusDot tone={status.tone} ping={a.status === "online"} />
                      {status.label}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {a.primary_ip ? (
                      <span className="block font-mono text-h2">{a.primary_ip}</span>
                    ) : (
                      <span className="text-meta">—</span>
                    )}
                    {a.vlan_number && <span className="font-mono text-xs text-meta">VLAN {a.vlan_number}</span>}
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
                  <td className="px-3 py-3 font-mono text-xs text-body">{resourceSummary(a) || <span className="text-meta">—</span>}</td>
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
function AssetCards({ assets }: { assets: Asset[] }) {
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
                  {[a.primary_ip, a.hostname, a.parent_name].filter(Boolean).join(" · ") || ASSET_KIND_META[a.kind].label}
                </span>
              </span>
              {resourceSummary(a) && <span className="hidden shrink-0 font-mono text-xs text-body sm:block">{resourceSummary(a)}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
