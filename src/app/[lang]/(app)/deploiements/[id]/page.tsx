import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowUpRight, PackagePlus, Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { deploymentOptions, getDeployment } from "@/lib/data/deployments";
import { listTasks } from "@/lib/data/tasks";
import { assetOptions } from "@/lib/data/assets";
import { deleteDeploymentAction, promoteDeploymentAction } from "@/actions/deployments";
import { DEPLOYMENT_KIND_META, PRIORITY_META, TASK_STATUS_META } from "@/lib/constants";
import { Badge, Tag } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Meter } from "@/components/ui/meter";
import { Skeleton } from "@/components/ui/skeleton";
import { Checklist } from "@/features/deployments/checklist";
import { StatusSwitcher } from "@/features/deployments/status-switcher";
import { TaskDialog } from "@/features/tasks/task-dialog";
import { cn, formatDate, formatDateTime, isOverdue, pct, timeAgo } from "@/lib/utils";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Déploiement") };
}

export default function DeploymentPage({ params }: PageProps<"/[lang]/deploiements/[id]">) {
  return (
    <Suspense fallback={<Skeleton className="h-[36rem] rounded-2xl" />}>
      <Detail params={params} />
    </Suspense>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-subtle py-2.5 last:border-0">
      <dt className="text-sm text-meta">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm text-h2">{children}</dd>
    </div>
  );
}

async function Detail({ params }: { params: PageProps<"/[lang]/deploiements/[id]">["params"] }) {
  const tr = await getT();
  await requireUser();
  const id = Number((await params).id);
  const d = getDeployment(id);
  if (!d) notFound();
  const tasks = listTasks({ deployment: id });
  const progress = pct(d.steps_done, d.steps_total);
  const late = d.status !== "done" && d.status !== "cancelled" && isOverdue(d.target_date);
  const taskOptions = {
    assets: assetOptions().map((a) => ({ id: a.id, display_name: a.display_name })),
    deployments: deploymentOptions(),
  };

  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      <header className="rise flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold tracking-tight text-h1 sm:text-4xl">{d.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={DEPLOYMENT_KIND_META[d.kind].tone}>{tr(DEPLOYMENT_KIND_META[d.kind].label)}</Badge>
            <Badge tone={PRIORITY_META[d.priority].tone}>{tr("Priorité ")}{tr(PRIORITY_META[d.priority].label).toLowerCase()}</Badge>
            {d.target_date && (
              <Badge tone={late ? "red" : "muted"}>
                {late ? tr("En retard · ") : tr("Cible · ")}
                {formatDate(d.target_date, tr.locale)}
              </Badge>
            )}
            {d.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/deploiements/${id}/modifier`} icon={<Pencil size={15} />}>
            {tr("Modifier")}</ButtonLink>
          <ConfirmButton
            action={deleteDeploymentAction.bind(null, id)}
            size="icon"
            message={tr("Supprimer le déploiement « {title} » et sa checklist ?", { title: d.title })}
          />
        </div>
      </header>

      <Card className="p-5">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-meta">{tr("État")}</p>
        <StatusSwitcher id={id} status={d.status} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3 xl:gap-8">
        <div className="grid min-w-0 content-start gap-6 lg:col-span-2">
          <Card>
            <CardHeader
              overline={tr("Ce qu'il faut faire")}
              title={d.steps_total ? tr("{done} / {total} étapes terminées", { done: d.steps_done, total: d.steps_total }) : tr("Checklist")}
            />
            <CardBody className="grid gap-5">
              {d.steps_total > 0 && (
                <Meter value={progress} tone={d.status === "blocked" ? "red" : progress === 100 ? "green" : "accent"} />
              )}
              <Checklist deploymentId={id} steps={d.steps} />
            </CardBody>
          </Card>

          {d.apps && (
            <Card>
              <CardHeader overline={tr("Conteneurs / apps déployés")} title={tr("{length} élément(s)", { length: d.apps.split(/[\n,;]+/).filter((a) => a.trim()).length })} />
              <CardBody>
                <ul className="flex flex-wrap gap-2">
                  {d.apps
                    .split(/[\n,;]+/)
                    .map((a) => a.replace(/^[-–•\s']+/, "").trim())
                    .filter(Boolean)
                    .map((a) => (
                      <li key={a} className="rounded-lg border border-line-subtle bg-page px-3 py-1.5 text-sm text-h2">
                        {a}
                      </li>
                    ))}
                </ul>
              </CardBody>
            </Card>
          )}

          {(d.description || d.notes) && (
            <Card>
              <CardHeader overline={tr("Notes")} title="Description & notes" />
              <CardBody className="grid gap-4">
                {d.description && <p className="whitespace-pre-line text-sm leading-relaxed text-body">{d.description}</p>}
                {d.notes && (
                  <pre className="whitespace-pre-wrap rounded-xl border border-line-subtle bg-crust p-4 font-mono text-xs leading-relaxed text-body">
                    {d.notes}
                  </pre>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              overline={tr("Tâches liées")}
              title={tr("{length} tâche(s)", { length: tasks.length })}
              actions={<TaskDialog options={taskOptions} defaultDeployment={id} variant="ghost" label={tr("Ajouter")} />}
            />
            <CardBody>
              {tasks.length === 0 ? (
                <p className="text-sm text-meta">{tr("Aucune tâche rattachée à ce déploiement.")}</p>
              ) : (
                <ul className="grid gap-2">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-line-subtle bg-page px-4 py-2.5">
                      <span className={cn("truncate text-sm", t.status === "done" ? "text-meta line-through" : "text-h2")}>{t.title}</span>
                      <Badge tone={TASK_STATUS_META[t.status].tone}>{tr(TASK_STATUS_META[t.status].label)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader overline={tr("Cible")} title={d.target_host_name ?? tr("Hôte à définir")} />
            <CardBody>
              <dl>
                {d.target_host_id && (
                  <Row label={tr("Hôte")}>
                    <Link href={`/inventaire/${d.target_host_id}`} className="hover:text-accent-text">
                      {d.target_host_name}
                    </Link>
                  </Row>
                )}
                <Row label={tr("ID (VMID)")}>
                  <span className="font-mono">{d.vmid ?? "—"}</span>
                </Row>
                <Row label={tr("vCPU / cœurs")}>{d.planned_cpu ?? "—"}</Row>
                <Row label={tr("Mémoire")}>{d.planned_ram_gb ? tr("{planned_ram_gb} Go", { planned_ram_gb: d.planned_ram_gb }) : "—"}</Row>
                <Row label={tr("Disque")}>{d.planned_disk_gb ? tr("{planned_disk_gb} Go", { planned_disk_gb: d.planned_disk_gb }) : "—"}</Row>
                <Row label={tr("IP prévue")}>
                  <span className="font-mono">{d.planned_ip || "—"}</span>
                </Row>
                {d.local_fqdn && (
                  <Row label={tr("FQDN local")}>
                    <span className="font-mono">{d.local_fqdn}</span>
                  </Row>
                )}
                {d.public_fqdn && (
                  <Row label={tr("FQDN public")}>
                    <a href={`https://${d.public_fqdn}`} target="_blank" rel="noreferrer" className="font-mono hover:text-accent-text">
                      {d.public_fqdn}
                    </a>
                  </Row>
                )}
                {d.subnet_name && (
                  <Row label={tr("Sous-réseau")}>
                    {d.subnet_name} <span className="font-mono text-meta">{d.subnet_cidr}</span>
                  </Row>
                )}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader overline={tr("Inventaire")} title={d.asset_name ?? tr("Pas encore créé")} />
            <CardBody>
              {d.asset_id ? (
                <ButtonLink href={`/inventaire/${d.asset_id}`} variant="secondary" className="w-full" icon={<ArrowUpRight size={15} />}>
                  {tr("Voir la fiche")}</ButtonLink>
              ) : (
                <form action={promoteDeploymentAction.bind(null, id)}>
                  <p className="mb-4 text-sm text-body">
                    {tr("Crée l'élément d'inventaire à partir des ressources prévues (IP réservée dans l'IPAM).")}</p>
                  <Button type="submit" variant="primary" className="w-full" icon={<PackagePlus size={15} />}>
                    {tr("Créer dans l'inventaire")}</Button>
                </form>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <dl>
                <Row label={tr("Créé le")}>{formatDate(d.created_at, tr.locale)}</Row>
                <Row label={tr("Modifié")}>
                  <span title={formatDateTime(d.updated_at, tr.locale)}>{timeAgo(d.updated_at, tr.locale)}</span>
                </Row>
                {d.completed_at && <Row label={tr("Terminé le")}>{formatDate(d.completed_at, tr.locale)}</Row>}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
