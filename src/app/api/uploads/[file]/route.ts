import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/lib/db";
import { getUploadedIcon } from "@/lib/data/shortcuts";

/** Sert les icônes téléversées (stockées dans DATA_DIR/uploads). */
export async function GET(_: Request, { params }: RouteContext<"/api/uploads/[file]">) {
  const { file } = await params;
  const name = path.basename(file);
  const icon = getUploadedIcon(name);
  if (!icon) return new Response("Introuvable", { status: 404 });
  try {
    const data = await fs.readFile(path.join(/*turbopackIgnore: true*/ UPLOADS_DIR, name));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": icon.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}
