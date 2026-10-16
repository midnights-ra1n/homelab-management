import { postForm, write } from "../lib/client";
import { navigate } from "../../ui";
import type { DeploymentStatus } from "../lib/constants";
import type { FormState } from "../lib/validation";

export const saveDeploymentAction = (id: number | null, _: FormState, fd: FormData) =>
  postForm(id ? `/api/mg/deployments/${id}` : "/api/mg/deployments", fd);
export const setDeploymentStatusAction = (id: number, status: DeploymentStatus) => write("POST", `/api/mg/deployments/${id}/status`, { status });
export const toggleStepAction = (stepId: number) => write("POST", `/api/mg/steps/${stepId}/toggle`);
export const addStepAction = (deploymentId: number, label: string) => write("POST", `/api/mg/deployments/${deploymentId}/steps`, { label });
export const deleteStepAction = (stepId: number) => write("DELETE", `/api/mg/steps/${stepId}`);

export async function deleteDeploymentAction(id: number) {
  await write("DELETE", `/api/mg/deployments/${id}`);
  navigate("/deploiements");
}

export async function promoteDeploymentAction(id: number) {
  const r = await write<{ redirect?: string }>("POST", `/api/mg/deployments/${id}/promote`);
  if (r?.redirect) navigate(r.redirect);
}
