import { connection } from "next/server";
import { get } from "@/lib/db";

/** Sonde de santé pour Docker / Proxmox (HEALTHCHECK). */
export async function GET() {
  await connection();
  try {
    get("SELECT 1");
    return Response.json({ status: "ok" });
  } catch (err) {
    console.error(err);
    return Response.json({ status: "error" }, { status: 500 });
  }
}
