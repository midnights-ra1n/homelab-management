"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm, success } from "@/lib/action-utils";
import {
  buildConfig,
  createIntegration,
  deleteIntegration,
  getIntegration,
  updateIntegration,
  type Integration,
} from "@/lib/data/integrations";
import { testIntegration } from "@/lib/integrations";
import { integrationSchema, type FormState } from "@/lib/validation";

export async function saveIntegrationAction(id: number | null, _: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(integrationSchema, fd);
  if (!parsed.ok) return parsed.state;
  try {
    if (id) updateIntegration(id, parsed.data, fd.get("clear_header") === "on");
    else createIntegration(parsed.data);
  } catch (err) {
    return dbError(err);
  }
  revalidatePath("/", "layout");
  return success(id ? "Intégration mise à jour." : "Intégration ajoutée.");
}

/** Teste la connexion avec les valeurs du formulaire (sans enregistrer). */
export async function testIntegrationAction(id: number | null, fd: FormData): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  const parsed = parseForm(integrationSchema, fd);
  if (!parsed.ok) return { ok: false, message: Object.values(parsed.state.errors ?? {})[0] ?? "Formulaire invalide" };
  const previous = id ? getIntegration(id) : undefined;
  const candidate: Integration = {
    id: id ?? -1,
    type: parsed.data.type,
    name: parsed.data.name,
    url: parsed.data.url,
    enabled: 1,
    config: buildConfig(parsed.data, previous?.config, previous?.url),
    created_at: "",
    updated_at: "",
  };
  try {
    return { ok: true, message: await testIntegration(candidate) };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export async function deleteIntegrationAction(id: number) {
  await requireUser();
  deleteIntegration(id);
  revalidatePath("/", "layout");
}
