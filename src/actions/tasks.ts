"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm, success } from "@/lib/action-utils";
import { TASK_STATUSES, type TaskStatus } from "@/lib/constants";
import { clearDoneTasks, createTask, deleteTask, moveTask, updateTask } from "@/lib/data/tasks";
import { taskSchema, type FormState } from "@/lib/validation";

export async function saveTaskAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(taskSchema, fd);
  if (!parsed.ok) return parsed.state;
  try {
    if (id) updateTask(id, parsed.data);
    else createTask(parsed.data);
  } catch (err) {
    return dbError(err);
  }
  revalidatePath("/", "layout");
  return success(id ? "Tâche mise à jour." : "Tâche créée.");
}

export async function moveTaskAction(id: number, status: TaskStatus, beforeId: number | null) {
  await requireUser();
  if (!TASK_STATUSES.includes(status)) return;
  moveTask(id, status, beforeId);
  revalidatePath("/", "layout");
}

export async function deleteTaskAction(id: number) {
  await requireUser();
  deleteTask(id);
  revalidatePath("/", "layout");
}

export async function clearDoneTasksAction() {
  await requireUser();
  clearDoneTasks();
  revalidatePath("/", "layout");
}
