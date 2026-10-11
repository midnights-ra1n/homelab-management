import { getCurrentUser } from "@/lib/auth";
import { getRequestT } from "@/i18n/server";
import { collectAlerts } from "@/lib/monitor/alerts";

export async function GET() {
  if (!(await getCurrentUser())) return new Response("Non autorisé", { status: 401 });
  const { alerts } = await collectAlerts(await getRequestT());
  return Response.json(alerts, { headers: { "Cache-Control": "no-store" } });
}
