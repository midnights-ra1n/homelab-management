import { act, postForm, write } from "../lib/client";
import type { FormState } from "../lib/validation";

const said = (message: string) => (r: { ok: boolean; message: string }) => (r.ok ? { ok: true, message } : r);

export const saveHardwareAction = (id: number | null, _: FormState, fd: FormData) => postForm(id ? `/api/mg/hardware/${id}` : "/api/mg/hardware", fd);
export const installHardwareAction = (id: number, parentId: number | null) =>
  act("POST", `/api/mg/hardware/${id}/install`, { parent_id: parentId }).then(said(parentId ? "Composant installé." : "Composant remis en stock."));
export const duplicateHardwareAction = (id: number) => act("POST", `/api/mg/hardware/${id}/duplicate`).then(said("Copie ajoutée au stock."));
export const deleteHardwareAction = (id: number) => write("DELETE", `/api/mg/hardware/${id}`);
