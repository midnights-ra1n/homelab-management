import { api, postForm, write } from "../lib/client";
import type { UploadedIcon } from "../lib/data/shortcuts";
import type { FormState } from "../lib/validation";

export const saveShortcutAction = (id: number | null, _: FormState, fd: FormData) =>
  postForm(id ? `/api/mg/shortcuts/${id}` : "/api/mg/shortcuts", fd);
export const deleteShortcutAction = (id: number) => write("DELETE", `/api/mg/shortcuts/${id}`);
export const reorderShortcutsAction = (groupId: number | null, ids: number[]) =>
  write("POST", "/api/mg/shortcuts/reorder", { group_id: groupId, ids: ids.filter((n) => Number.isInteger(n)) });
export const saveGroupAction = (id: number | null, _: FormState, fd: FormData) => postForm(id ? `/api/mg/groups/${id}` : "/api/mg/groups", fd);
export const deleteGroupAction = (id: number) => write("DELETE", `/api/mg/groups/${id}`);
export const moveGroupAction = (id: number, direction: -1 | 1) => write("POST", `/api/mg/groups/${id}/move`, { direction });

/** Availability of the shortcuts (no data refresh: read only). */
export const probeShortcutsAction = (urls: string[]) =>
  api.post<Record<string, { up: boolean; status?: number; ms: number }>>("/api/mg/shortcuts/probe", { urls });

export const searchIconsAction = (query: string, provider?: "dashboard" | "selfhst") =>
  api.get<{ provider: "dashboard" | "selfhst"; name: string; label: string }[]>(
    `/api/mg/icons/search?q=${encodeURIComponent(query)}${provider ? `&provider=${provider}` : ""}`,
  );

export const uploadIconAction = (_: FormState & { icon?: UploadedIcon }, fd: FormData) =>
  postForm("/api/mg/icons", fd) as Promise<FormState & { icon?: UploadedIcon }>;
export const deleteUploadedIconAction = (id: number) => write("DELETE", `/api/mg/icons/${id}`);
export const listUploadedIconsAction = () => api.get<{ icons: UploadedIcon[] }>("/api/mg/shortcuts").then((h) => h.icons);
