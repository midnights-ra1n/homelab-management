import assert from "node:assert/strict";
import { test } from "node:test";
import { jpegToPdf } from "./pdf";

test("PDF image : offsets xref exacts et image embarquée telle quelle", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = jpegToPdf(jpeg, 800, 600);
  const text = new TextDecoder("latin1").decode(pdf);
  assert.ok(text.startsWith("%PDF-1.4\n") && text.endsWith("%%EOF\n"));
  assert.match(text, /\/MediaBox \[0 0 600 450\]/);

  const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(entries.length, 5);
  entries.forEach((off, i) => assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));

  const at = text.indexOf("stream\n", text.indexOf("/DCTDecode")) + "stream\n".length;
  assert.deepEqual(pdf.slice(at, at + jpeg.length), jpeg);
});
