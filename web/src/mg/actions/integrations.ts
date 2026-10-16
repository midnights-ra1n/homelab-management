import { act, postForm, write } from "../lib/client";
import type { FormState } from "../lib/validation";

export const saveIntegrationAction = (id: number | null, _: FormState, fd: FormData) =>
  postForm(id ? `/api/mg/integrations/${id}` : "/api/mg/integrations", fd);
export const deleteIntegrationAction = (id: number) => write("DELETE", `/api/mg/integrations/${id}`);

/** Tests the form's values without saving them. */
export async function testIntegrationAction(id: number | null, fd: FormData): Promise<{ ok: boolean; message: string }> {
  if (id) fd.set("id", String(id));
  const res = await fetch("/api/mg/integrations/test", { method: "POST", body: fd, credentials: "same-origin" });
  return res.ok ? res.json() : { ok: false, message: `Erreur ${res.status}` };
}

export const syncNowAction = () => act("POST", "/api/mg/sync");
