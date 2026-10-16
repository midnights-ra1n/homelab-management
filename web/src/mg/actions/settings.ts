import { act } from "../lib/client";

export async function setTimeZoneAction(tz: string): Promise<{ ok: boolean; message: string }> {
  const r = await act("PUT", "/api/settings", { timezone: tz });
  return r.ok ? { ok: true, message: "Fuseau horaire enregistré." } : r;
}
