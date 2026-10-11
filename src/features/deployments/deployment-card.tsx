import Link from "next/link";
import { CalendarDays, Server } from "lucide-react";
import { Badge, Tag } from "@/components/ui/badge";
import { Meter } from "@/components/ui/meter";
import { DEPLOYMENT_KIND_META, DEPLOYMENT_STATUS_META, PRIORITY_META } from "@/lib/constants";
import type { Deployment } from "@/lib/data/deployments";
import { cn, formatDate, isOverdue, pct } from "@/lib/utils";
import { getT } from "@/i18n/server";

export async function DeploymentCard({ d }: { d: Deployment }) {
  const tr = await getT();
  const status = DEPLOYMENT_STATUS_META[d.status];
  const progress = pct(d.steps_done, d.steps_total);
  const late = d.status !== "done" && d.status !== "cancelled" && isOverdue(d.target_date);
  return (
    <Link
      href={`/deploiements/${d.id}`}
      className="group flex h-full flex-col rounded-2xl border border-line-subtle bg-box p-5 transition-colors duration-200 hover:border-line-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <Badge tone={DEPLOYMENT_KIND_META[d.kind].tone}>{tr(DEPLOYMENT_KIND_META[d.kind].label)}</Badge>
        <Badge tone={status.tone} dot>
          {tr(status.label)}
        </Badge>
      </div>
      <h3 className="mt-4 text-base font-semibold text-h1 group-hover:text-accent-text">{d.title}</h3>
      {d.description && <p className="mt-1 line-clamp-2 text-sm text-body">{d.description}</p>}
      <div className="mt-auto pt-5">
        {d.steps_total > 0 && (
          <Meter
            value={progress}
            tone={d.status === "blocked" ? "red" : progress === 100 ? "green" : "accent"}
            label={tr("{done}/{total} étapes", { done: d.steps_done, total: d.steps_total })}
            detail={`${progress} %`}
            size="sm"
          />
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-meta">
          {d.priority !== "medium" && <Badge tone={PRIORITY_META[d.priority].tone}>{tr(PRIORITY_META[d.priority].label)}</Badge>}
          {d.target_host_name && (
            <span className="flex items-center gap-1.5">
              <Server size={13} aria-hidden="true" /> {d.target_host_name}
            </span>
          )}
          {d.target_date && (
            <span className={cn("flex items-center gap-1.5 font-mono", late && "text-red")}>
              <CalendarDays size={13} aria-hidden="true" /> {formatDate(d.target_date, tr.locale)}
              {late && tr(" · en retard")}
            </span>
          )}
          {d.tags.slice(0, 3).map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      </div>
    </Link>
  );
}
