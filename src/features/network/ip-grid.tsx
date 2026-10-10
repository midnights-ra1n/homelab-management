"use client";

import { useState } from "react";
import { IP_STATUS_META, TONE_VAR, type AssetKind, type IpStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { IpAssignDialog } from "./dialogs";

export type GridCell = {
  address: string;
  last: number;
  status: IpStatus | "gateway" | "network" | "broadcast" | "dhcp-range" | "free";
  label?: string;
};

const CELL_STYLE: Record<GridCell["status"], { bg: string; text?: string; label: string }> = {
  used: { bg: TONE_VAR.accent, text: "var(--mm-on-accent)", label: IP_STATUS_META.used.label },
  reserved: { bg: TONE_VAR.yellow, text: "var(--mm-on-accent)", label: IP_STATUS_META.reserved.label },
  dhcp: { bg: TONE_VAR.blue, text: "var(--mm-on-accent)", label: "Bail DHCP" },
  gateway: { bg: TONE_VAR.purple, text: "var(--mm-on-accent)", label: "Passerelle" },
  network: { bg: "var(--mm-border)", label: "Réseau" },
  broadcast: { bg: "var(--mm-border)", label: "Broadcast" },
  "dhcp-range": { bg: "color-mix(in srgb, var(--mm-blue) 22%, var(--mm-bg-elevated))", label: "Plage DHCP" },
  free: { bg: "var(--mm-bg-elevated)", label: "Libre" },
};

/** Grille d'occupation d'un sous-réseau ; cliquer une case libre l'attribue. */
export function IpGrid({
  cells,
  subnetId,
  subnets,
  assets,
}: {
  cells: GridCell[];
  subnetId: number;
  subnets: { id: number; name: string; cidr: string }[];
  assets: { id: number; display_name: string; kind: AssetKind }[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1">
        {cells.map((c) => {
          const style = CELL_STYLE[c.status];
          const clickable = c.status === "free" || c.status === "dhcp-range";
          return (
            <button
              key={c.address}
              type="button"
              disabled={!clickable}
              onClick={() => setSelected(c.address)}
              title={`${c.address} — ${style.label}${c.label ? ` · ${c.label}` : ""}`}
              aria-label={`${c.address} : ${style.label}${c.label ? `, ${c.label}` : ""}`}
              className={cn(
                "flex h-9 items-center justify-center rounded-md font-mono text-[0.65rem] tabular-nums transition-[transform,filter] duration-150",
                clickable ? "cursor-pointer text-meta hover:scale-110 hover:brightness-125" : "cursor-default",
              )}
              style={{ background: style.bg, color: style.text }}
            >
              {c.last}
            </button>
          );
        })}
      </div>
      <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-body">
        {(["used", "reserved", "dhcp", "gateway", "dhcp-range", "free"] as const).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm border border-line" style={{ background: CELL_STYLE[k].bg }} aria-hidden="true" />
            {CELL_STYLE[k].label}
          </li>
        ))}
      </ul>
      <IpAssignDialog
        address={selected}
        onClose={() => setSelected(null)}
        subnets={subnets}
        assets={assets}
        defaultSubnet={subnetId}
      />
    </>
  );
}
