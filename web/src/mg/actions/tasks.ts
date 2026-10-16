import { postForm, write } from "../lib/client";
import type { TaskStatus } from "../lib/constants";
import type { FormState } from "../lib/validation";

export const saveTaskAction = (id: number | null, _: FormState, fd: FormData) => postForm(id ? `/api/mg/tasks/${id}` : "/api/mg/tasks", fd);
export const moveTaskAction = (id: number, status: TaskStatus, beforeId: number | null) =>
  write("POST", `/api/mg/tasks/${id}/move`, { status, before: beforeId });
export const deleteTaskAction = (id: number) => write("DELETE", `/api/mg/tasks/${id}`);
export const clearDoneTasksAction = () => write("POST", "/api/mg/tasks/clear-done");
