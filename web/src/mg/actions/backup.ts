import { postForm } from "../lib/client";
import type { FormState } from "../lib/validation";

export const importBackupAction = (_: FormState, fd: FormData) => postForm("/api/mg/import", fd);
