import { postForm, write } from "../lib/client";
import type { FormState } from "../lib/validation";

export const saveSshKeyAction = (_: FormState, fd: FormData) => postForm("/api/mg/ssh-keys", fd);
export const deleteSshKeyAction = (id: number) => write("DELETE", `/api/mg/ssh-keys/${id}`);
