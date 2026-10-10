import "server-only";
import { all, get, run, transaction } from "../db";
import {
  ACTIVE_DEPLOYMENT_STATUSES,
  DEPLOYMENT_STATUS_META,
  type DeploymentKind,
  type DeploymentStatus,
  type Priority,
} from "../constants";
import { parseJson } from "../utils";
import type { DeploymentInput } from "../validation";
import { logActivity } from "./activity";

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

const SELECT = `
  SELECT d.*, h.display_name AS target_host_name, a.display_name AS asset_name,
    s.name AS subnet_name, s.cidr AS subnet_cidr,
    (SELECT COUNT(*) FROM deployment_steps st WHERE st.deployment_id = d.id) AS steps_total,
    (SELECT COUNT(*) FROM deployment_steps st WHERE st.deployment_id = d.id AND st.done = 1) AS steps_done
  FROM deployments d
  LEFT JOIN assets h ON h.id = d.target_host_id
  LEFT JOIN assets a ON a.id = d.asset_id
  LEFT JOIN subnets s ON s.id = d.subnet_id`;

const ORDER = `ORDER BY
  CASE d.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'testing' THEN 2 WHEN 'preparing' THEN 3
    WHEN 'planned' THEN 4 WHEN 'done' THEN 5 ELSE 6 END,
  CASE d.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  COALESCE(d.target_date, '9999') , d.id DESC`;

function hydrate(row: Omit<Deployment, "tags"> & { tags: string }): Deployment {
  return { ...row, tags: parseJson<string[]>(row.tags, []) };
}

export function listDeployments(filters: { status?: string; kind?: string; q?: string } = {}): Deployment[] {
  const where: string[] = [];
  const params: string[] = [];
  if (filters.status === "active") {
    where.push(`d.status IN (${ACTIVE_DEPLOYMENT_STATUSES.map(() => "?").join(",")})`);
    params.push(...ACTIVE_DEPLOYMENT_STATUSES);
  } else if (filters.status && filters.status in DEPLOYMENT_STATUS_META) {
    where.push("d.status = ?");
    params.push(filters.status);
  }
  if (filters.kind) {
    where.push("d.kind = ?");
    params.push(filters.kind);
  }
  if (filters.q) {
    where.push("(d.title LIKE ? OR d.description LIKE ? OR d.tags LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
  }
  return all<Omit<Deployment, "tags"> & { tags: string }>(
    `${SELECT} ${where.length ? "WHERE " + where.join(" AND ") : ""} ${ORDER}`,
    params,
  ).map(hydrate);
}

export function getDeployment(id: number) {
  const row = get<Omit<Deployment, "tags"> & { tags: string }>(`${SELECT} WHERE d.id = ?`, [id]);
  if (!row) return undefined;
  const steps = all<DeploymentStep>(
    "SELECT id, label, done, position FROM deployment_steps WHERE deployment_id = ? ORDER BY position, id",
    [id],
  );
  return { ...hydrate(row), steps };
}

export function deploymentCounts() {
  const rows = all<{ status: DeploymentStatus; n: number }>("SELECT status, COUNT(*) AS n FROM deployments GROUP BY status");
  const by: Partial<Record<DeploymentStatus, number>> = {};
  for (const r of rows) by[r.status] = r.n;
  const active = ACTIVE_DEPLOYMENT_STATUSES.reduce((n, s) => n + (by[s] ?? 0), 0);
  return { by, active, total: rows.reduce((n, r) => n + r.n, 0) };
}

function columns(input: DeploymentInput) {
  return {
    title: input.title,
    kind: input.kind,
    status: input.status,
    priority: input.priority,
    description: input.description,
    target_host_id: input.target_host_id,
    asset_id: input.asset_id,
    planned_cpu: input.planned_cpu,
    planned_ram_gb: input.planned_ram_gb,
    planned_disk_gb: input.planned_disk_gb,
    planned_ip: input.planned_ip,
    subnet_id: input.subnet_id,
    target_date: input.target_date,
    notes: input.notes,
    tags: JSON.stringify(input.tags),
    vmid: input.vmid,
    apps: input.apps,
    local_fqdn: input.local_fqdn,
    public_fqdn: input.public_fqdn,
  };
}

function replaceSteps(deploymentId: number, steps: DeploymentInput["steps"]) {
  run("DELETE FROM deployment_steps WHERE deployment_id = ?", [deploymentId]);
  steps.forEach((s, i) =>
    run("INSERT INTO deployment_steps (deployment_id, label, done, position) VALUES (?, ?, ?, ?)", [
      deploymentId,
      s.label,
      s.done ? 1 : 0,
      i,
    ]),
  );
}

export function createDeployment(input: DeploymentInput): number {
  return transaction(() => {
    const cols = columns(input);
    const keys = Object.keys(cols);
    const { lastId } = run(
      `INSERT INTO deployments (${keys.join(",")}, completed_at) VALUES (${keys.map((k) => ":" + k).join(",")},
       CASE WHEN :status = 'done' THEN datetime('now') END)`,
      cols,
    );
    replaceSteps(lastId, input.steps);
    logActivity("deployment", lastId, "create", `Nouveau déploiement « ${input.title} »`);
    return lastId;
  });
}

export function updateDeployment(id: number, input: DeploymentInput) {
  transaction(() => {
    const before = get<{ status: string }>("SELECT status FROM deployments WHERE id = ?", [id]);
    const cols = columns(input);
    run(
      `UPDATE deployments SET ${Object.keys(cols)
        .map((k) => `${k} = :${k}`)
        .join(", ")},
       completed_at = CASE WHEN :status = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
       updated_at = datetime('now') WHERE id = :id`,
      { ...cols, id },
    );
    replaceSteps(id, input.steps);
    const summary =
      before && before.status !== input.status
        ? `« ${input.title} » → ${DEPLOYMENT_STATUS_META[input.status].label}`
        : `Modification du déploiement « ${input.title} »`;
    logActivity("deployment", id, "update", summary);
  });
}

export function setDeploymentStatus(id: number, status: DeploymentStatus) {
  run(
    `UPDATE deployments SET status = ?, updated_at = datetime('now'),
     completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END WHERE id = ?`,
    [status, status, id],
  );
  const d = get<{ title: string }>("SELECT title FROM deployments WHERE id = ?", [id]);
  if (d) logActivity("deployment", id, "update", `« ${d.title} » → ${DEPLOYMENT_STATUS_META[status].label}`);
}

export function toggleStep(stepId: number) {
  run("UPDATE deployment_steps SET done = 1 - done WHERE id = ?", [stepId]);
  const step = get<{ deployment_id: number }>("SELECT deployment_id FROM deployment_steps WHERE id = ?", [stepId]);
  if (step) run("UPDATE deployments SET updated_at = datetime('now') WHERE id = ?", [step.deployment_id]);
}

export function addStep(deploymentId: number, label: string) {
  const pos = get<{ p: number }>(
    "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM deployment_steps WHERE deployment_id = ?",
    [deploymentId],
  )!.p;
  run("INSERT INTO deployment_steps (deployment_id, label, position) VALUES (?, ?, ?)", [deploymentId, label, pos]);
}

export function deleteStep(stepId: number) {
  run("DELETE FROM deployment_steps WHERE id = ?", [stepId]);
}

export function deleteDeployment(id: number) {
  const d = get<{ title: string }>("SELECT title FROM deployments WHERE id = ?", [id]);
  run("DELETE FROM deployments WHERE id = ?", [id]);
  if (d) logActivity("deployment", id, "delete", `Suppression du déploiement « ${d.title} »`);
}

export function deploymentOptions() {
  return all<{ id: number; title: string }>(
    `SELECT id, title FROM deployments WHERE status NOT IN ('done','cancelled') ORDER BY title`,
  );
}
