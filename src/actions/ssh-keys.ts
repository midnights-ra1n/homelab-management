"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { dbError, parseForm, success } from "@/lib/action-utils";
import { deleteSshKey, generateSshKey, importSshKey, SshKeyError } from "@/lib/data/ssh-keys";
import { sshKeySchema, type FormState } from "@/lib/validation";

export async function saveSshKeyAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser();
  const parsed = parseForm(sshKeySchema, fd);
  if (!parsed.ok) return parsed.state;
  const { name, mode, private_key } = parsed.data;
  if (mode === "import" && !private_key) return { errors: { private_key: "Colle la clé privée" } };
  try {
    if (mode === "import") importSshKey(name, private_key);
    else generateSshKey(name, mode);
  } catch (err) {
    if (err instanceof SshKeyError) return { errors: { private_key: err.message } };
    return dbError(err, "name", "Une clé porte déjà ce nom");
  }
  revalidatePath("/", "layout");
  return success(mode === "import" ? "Clé importée." : "Clé générée : ajoute la clé publique dans authorized_keys.");
}

export async function deleteSshKeyAction(id: number) {
  await requireUser();
  deleteSshKey(id);
  revalidatePath("/", "layout");
}
