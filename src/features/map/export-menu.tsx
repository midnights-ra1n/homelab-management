"use client";

import { Download } from "lucide-react";
import { useRef, useState } from "react";
import { getNodesBounds, useReactFlow } from "@xyflow/react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toaster";
import { jpegToPdf } from "@/lib/pdf";
import { useT } from "@/i18n/client";

type Format = "png" | "jpeg" | "svg" | "pdf";
const FORMATS: { value: Format; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "svg", label: "SVG" },
  { value: "pdf", label: "PDF" },
];
const PAD = 48;

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

/** Export de toute la carte (pas seulement la zone visible), avec le fond courant. */
export function ExportMenu({ container }: { container: React.RefObject<HTMLDivElement | null> }) {
  const tr = useT();
  const toast = useToast();
  const { getNodes } = useReactFlow();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(format: Format) {
    setOpen(false);
    const root = container.current;
    const viewport = root?.querySelector<HTMLElement>(".react-flow__viewport");
    const nodes = getNodes().filter((n) => !n.hidden);
    if (!root || !viewport || !nodes.length) return;
    setBusy(true);
    try {
      const { toJpeg, toPng, toSvg } = await import("html-to-image");
      const b = getNodesBounds(nodes);
      const width = Math.ceil(b.width + PAD * 2);
      const height = Math.ceil(b.height + PAD * 2);
      const opts = {
        width,
        height,
        backgroundColor: getComputedStyle(root).backgroundColor,
        pixelRatio: format === "svg" ? 1 : 2,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${PAD - b.x}px, ${PAD - b.y}px) scale(1)` },
      };
      const name = `homelab-carte-${new Date().toISOString().slice(0, 10)}`;
      if (format === "png") download(await toPng(viewport, opts), `${name}.png`);
      else if (format === "svg") download(await toSvg(viewport, opts), `${name}.svg`);
      else {
        const jpeg = await toJpeg(viewport, { ...opts, quality: 0.92 });
        if (format === "jpeg") download(jpeg, `${name}.jpeg`);
        else {
          const bytes = Uint8Array.from(atob(jpeg.split(",")[1]), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([jpegToPdf(bytes, width * 2, height * 2) as BlobPart], { type: "application/pdf" }));
          download(url, `${name}.pdf`);
          setTimeout(() => URL.revokeObjectURL(url), 10_000);
        }
      }
    } catch (e) {
      toast("error", tr("Export impossible : {error}", { error: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        ref={anchorRef}
        variant="secondary"
        size="icon"
        className="bg-page/90 backdrop-blur"
        title={tr("Exporter la carte")}
        aria-label={tr("Exporter la carte")}
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        icon={<Download size={15} />}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="end" className="w-40" label={tr("Exporter la carte")}>
        <ul role="menu" aria-label={tr("Exporter la carte")}>
          {FORMATS.map((f) => (
            <li key={f.value}>
              <button
                type="button"
                role="menuitem"
                onClick={() => void run(f.value)}
                className="flex min-h-10 w-full items-center rounded-full px-3 py-2 text-left text-sm text-h2 transition-colors hover:bg-box hover:text-h1"
              >
                {f.label}
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
