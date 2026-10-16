// Types of homelab-management's lib/data/deployments.ts + client fetchers.
import { get, qs } from "../client";
import { resource } from "../resource";
import { ACTIVE_DEPLOYMENT_STATUSES } from "../constants";
import { type DeploymentKind, type DeploymentStatus, type Priority } from "../constants";

export type DeploymentStep = { id: number; label: string; done: number; position: number };

export type Deployment = {
  id: number;
  title: string;
  kind: DeploymentKind;
  status: DeploymentStatus;
  priority: Priority;
  description: string;
  target_host_id: number | null;
  target_host_name: string | null;
  asset_id: number | null;
  asset_name: string | null;
  planned_cpu: number | null;
  planned_ram_gb: number | null;
  planned_disk_gb: number | null;
  planned_ip: string;
  subnet_id: number | null;
  subnet_name: string | null;
  subnet_cidr: string | null;
  target_date: string | null;
  notes: string;
  vmid: number | null;
  apps: string;
  local_fqdn: string;
  public_fqdn: string;
  tags: string[];
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  steps_total: number;
  steps_done: number;
};


/* ---------------------------------------------------------------- fetchers */

export const listDeployments = (filters: { status?: string; kind?: string; q?: string; asset?: number } = {}) =>
  get<Deployment[]>(`/api/mg/deployments${qs(filters)}`);
export const getDeployment = (id: number) =>
  resource(`deployment:${id}`, () =>
    get<Deployment & { steps: DeploymentStep[] }>(`/api/mg/deployments/${id}`).then(
      (d) => d as (Deployment & { steps: DeploymentStep[] }) | undefined,
      () => undefined,
    ),
  );

type Work = {
  deployments: { id: number; title: string }[];
  deployment_counts: { status: DeploymentStatus; n: number }[];
  task_tags: { tag: string }[];
  task_counts: { todo: number; in_progress: number; done: number; overdue: number }[];
  open_tasks: import("./tasks").Task[];
};
export const workData = () => get<Work>("/api/mg/work");
export const deploymentOptions = () => resource("work:dep-options", () => workData().then((w) => w.deployments));
export const deploymentCounts = () =>
  resource("work:dep-counts", () =>
    workData().then((w) => {
      const by: Partial<Record<DeploymentStatus, number>> = {};
      for (const r of w.deployment_counts) by[r.status] = r.n;
      const active = ACTIVE_DEPLOYMENT_STATUSES.reduce((n, s) => n + (by[s] ?? 0), 0);
      return { by, active, total: w.deployment_counts.reduce((n, r) => n + r.n, 0) };
    }),
  );
