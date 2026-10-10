import { getCurrentUser } from "@/lib/auth";
import { exportBackup } from "@/lib/data/backup";

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return new Response("Non autorisé", { status: 401 });
  const secrets = new URL(request.url).searchParams.get("secrets") === "1";
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(exportBackup(secrets), null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="homelab-backup-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
