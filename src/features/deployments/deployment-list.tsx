import Link from "next/link";
import { CalendarDays, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { DEPLOYMENT_KIND_META, PRIORITY_META, TONE_VAR } from "@/lib/constants";
import type { Deployment } from "@/lib/data/deployments";
import { cn, formatDate, isOverdue, pct } from "@/lib/utils";
import { StatusPicker } from "./status-picker";

function appsSummary(apps: string) {
  const list = apps
    .split(/[\n,;]+/)
    .map((a) => a.replace(/^[-–•\s']+/, "").trim())
    .filter(Boolean);
  if (list.length <= 2) return list.join(", ");
  return `${list.slice(0, 2).join(", ")} +${list.length - 2}`;
}

/** Vue en lignes : état modifiable d'un clic, le reste via « Modifier ». */
export function DeploymentList({ deployments }: { deployments: Deployment[] }) {
  return (
    <>
      <ul className="grid gap-2 md:hidden">
        {deployments.map((d) => {
          const progress = pct(d.steps_done, d.steps_total);
          return (
            <li key={d.id} className="rounded-2xl border border-line-subtle bg-box p-4">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/deploiements/${d.id}`} className="min-w-0">
                  <span className="block truncate font-medium text-h1">{d.title}</span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-meta">
                    {[DEPLOYMENT_KIND_META[d.kind].label, d.target_host_name, d.vmid].filter(Boolean).join(" · ")}
                  </span>
                </Link>
                <ButtonLink
                  href={`/deploiements/${d.id}/modifier`}
                  variant="secondary"
                  size="icon"
                  aria-label={`Modifier ${d.title}`}
                  icon={<Pencil size={15} />}
                />
              </div>
              <div className="mt-3 flex items-center gap-3">
                <StatusPicker id={d.id} status={d.status} />
                {d.steps_total > 0 && (
                  <span className="flex flex-1 items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
                    </span>
                    <span className="font-mono text-xs text-meta">
                      {d.steps_done}/{d.steps_total}
                    </span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="hidden rounded-2xl border border-line-subtle bg-box md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <thead>
            <tr className="border-b border-line-subtle font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
              <th className="px-5 py-3 font-medium">Déploiement</th>
              <th className="px-3 py-3 font-medium">Nœud</th>
              <th className="px-3 py-3 font-medium">ID</th>
              <th className="px-3 py-3 font-medium">Conteneurs / apps</th>
              <th className="px-3 py-3 font-medium">État</th>
              <th className="px-3 py-3 font-medium">Avancement</th>
              <th className="px-3 py-3 font-medium">Cible</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((d) => {
              const progress = pct(d.steps_done, d.steps_total);
              const late = d.status !== "done" && d.status !== "cancelled" && isOverdue(d.target_date);
              const priority = PRIORITY_META[d.priority];
              return (
                <tr key={d.id} className="group border-b border-line-subtle transition-colors last:border-0 hover:bg-elevated/40 [&>td]:py-4">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_VAR[priority.tone] }} title={`Priorité ${priority.label}`} />
                      <div className="min-w-0">
                        <Link href={`/deploiements/${d.id}`} className="block truncate font-medium text-h1 hover:text-accent-text">
                          {d.title}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-2">
                          <Badge tone={DEPLOYMENT_KIND_META[d.kind].tone} className="px-2 py-0 text-[0.68rem]">
                            {DEPLOYMENT_KIND_META[d.kind].label}
                          </Badge>
                          {d.public_fqdn && <span className="truncate font-mono text-xs text-meta">{d.public_fqdn}</span>}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-body">
                    {d.target_host_id ? (
                      <Link href={`/inventaire/${d.target_host_id}`} className="hover:text-accent-text">
                        {d.target_host_name}
                      </Link>
                    ) : (
                      <span className="text-meta">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 font-mono text-h2">{d.vmid ?? <span className="text-meta">—</span>}</td>
                  <td className="max-w-[14rem] truncate px-3 py-3 text-body" title={d.apps}>
                    {appsSummary(d.apps) || <span className="text-meta">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <StatusPicker id={d.id} status={d.status} />
                  </td>
                  <td className="px-3 py-3">
                    {d.steps_total > 0 ? (
                      <div className="flex w-32 items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                          <span
                            className="block h-full rounded-full"
                            style={{ width: `${progress}%`, background: TONE_VAR[d.status === "blocked" ? "red" : progress === 100 ? "green" : "accent"] }}
                          />
                        </span>
                        <span className="w-12 text-right font-mono text-xs text-meta">
                          {d.steps_done}/{d.steps_total}
                        </span>
                      </div>
                    ) : (
                      <span className="text-meta">—</span>
                    )}
                  </td>
                  <td className={cn("whitespace-nowrap px-3 py-3 font-mono text-xs", late ? "text-red" : "text-meta")}>
                    {d.target_date ? (
                      <span className="flex items-center gap-1.5">
                        <CalendarDays size={12} aria-hidden /> {formatDate(d.target_date)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <ButtonLink href={`/deploiements/${d.id}/modifier`} variant="secondary" size="sm" icon={<Pencil size={13} />}>
                      Modifier
                    </ButtonLink>
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
