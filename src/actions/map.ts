"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { LINK_KINDS, type LinkKind } from "@/lib/constants";
import { createLink, deleteLink, resetPositions, savePositions } from "@/lib/data/map";

export async function savePositionsAction(positions: { id: number; x: number; y: number }[]) {
  await requireUser();
  savePositions(positions.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isInteger(p.id)));
}

export async function resetPositionsAction() {
  await requireUser();
  resetPositions();
  revalidatePath("/carte");
}

export async function createLinkAction(source: number, target: number, kind: LinkKind, label: string) {
  await requireUser();
  if (!LINK_KINDS.includes(kind)) return;
  createLink(source, target, kind, label.slice(0, 60));
  revalidatePath("/carte");
}

export async function deleteLinkAction(id: number) {
  await requireUser();
  deleteLink(id);
  revalidatePath("/carte");
}
