/**
 * PDF d'une page contenant une seule image JPEG (filtre DCTDecode : le JPEG est
 * embarqué tel quel). Taille de page = taille de l'image, à 96 dpi.
 */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const enc = new TextEncoder();
  const w = +(width * 0.75).toFixed(2);
  const h = +(height * 0.75).toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const objects: (string | [string, Uint8Array, string])[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    [
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      "\nendstream",
    ],
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  const parts: Uint8Array[] = [];
  let size = 0;
  const push = (p: string | Uint8Array) => {
    const b = typeof p === "string" ? enc.encode(p) : p;
    parts.push(b);
    size += b.length;
  };
  push("%PDF-1.4\n");
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(size);
    push(`${i + 1} 0 obj\n`);
    if (typeof o === "string") push(o);
    else o.forEach(push);
    push("\nendobj\n");
  });
  const xref = size;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
