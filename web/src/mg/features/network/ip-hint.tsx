
import Link from "next/link";
import { useEffect, useState } from "react";
import { checkIpAction } from "@/actions/network";
import type { Issue } from "@/lib/net/engine";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

const GLYPH = { error: "✕", warning: "!", info: "✓" } as const;

/** Vérifie une IP pendant la saisie : doublon, passerelle, réseau/broadcast… */
export function IpHint({
  address,
  subnetId,
  assetId,
  ipId,
}: {
  address: string;
  subnetId?: number | null;
  assetId?: number | null;
  ipId?: number | null;
}) {
  const tr = useT();
  const [result, setResult] = useState<{ for: string; issues: Issue[] } | null>(null);

  useEffect(() => {
    const value = address.trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(value)) return;
    let alive = true;
    const t = setTimeout(() => {
      checkIpAction(value, { subnetId, assetId, ipId }).then((issues) => alive && setResult({ for: `${value}|${subnetId}`, issues }));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [address, subnetId, assetId, ipId]);

  if (!result || result.for !== `${address.trim()}|${subnetId}`) return null;
  return (
    <ul className="mt-2 grid gap-1" aria-live="polite">
      {result.issues.map((i) => (
        <li
          key={i.code + i.message}
          className={cn(
            "flex items-start gap-1.5 text-xs",
            i.level === "error" ? "text-red" : i.level === "warning" ? "text-yellow" : "text-green",
          )}
        >
          <span aria-hidden="true" className="font-bold">
            {GLYPH[i.level]}
          </span>
          {i.href ? (
            <Link href={i.href} className="underline-offset-2 hover:underline">
              {tr(i.message)}
            </Link>
          ) : (
            i.message
          )}
        </li>
      ))}
    </ul>
  );
}
