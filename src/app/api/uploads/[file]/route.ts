import fs from "node:fs/promises";
import path from "node:path";
import { UPLOADS_DIR } from "@/lib/db";
import { getUploadedIcon } from "@/lib/data/shortcuts";

const IMAGE_MIME = new Set(["image/png", "image/svg+xml", "image/webp", "image/jpeg", "image/x-icon", "image/vnd.microsoft.icon", "image/gif"]);

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
        // Le type vient de la base (restaurable depuis une sauvegarde) : jamais autre chose qu'une image.
        "Content-Type": IMAGE_MIME.has(icon.mime) ? icon.mime : "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}
