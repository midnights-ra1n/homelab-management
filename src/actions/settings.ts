"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { applyTimeZone, setSetting, timeZones } from "@/lib/data/settings";
import { TZ_COOKIE } from "@/lib/utils";

export async function setTimeZoneAction(tz: string): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  if (!timeZones().includes(tz)) return { ok: false, message: "Fuseau horaire inconnu" };
  setSetting("timezone", tz);
  applyTimeZone(tz);
  (await cookies()).set(TZ_COOKIE, tz, { path: "/", maxAge: 31536000, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true, message: "Fuseau horaire enregistré." };
}
