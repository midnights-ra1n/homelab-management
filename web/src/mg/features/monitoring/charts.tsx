
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TONE_VAR } from "@/lib/constants";
import { cn, dateFormat } from "@/lib/utils";
import { uptimeTone, formatPct } from "@/lib/monitor/format";
import { useT } from "@/i18n/client";

/* --------------------------------------------------------------------------
 * Utilitaires
 * ------------------------------------------------------------------------ */

const noop = () => () => {};
/** Les dates sont formatées dans le fuseau du navigateur : rendu côté client uniquement. */
function useIsClient() {
  return useSyncExternalStore(noop, () => true, () => false);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/* --------------------------------------------------------------------------
 * Barres de disponibilité (90 jours façon status page)
 * ------------------------------------------------------------------------ */

export type DayBar = { day: string; checks: number; uptime: number | null; avg: number | null };

export function UptimeBars({ days: allDays, height = 32, className }: { days: DayBar[]; height?: number; className?: string }) {
  const tr = useT();
  const isClient = useIsClient();
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();
  // Écran étroit : on garde les N derniers jours qui tiennent (≥ 3 px par barre + 2 px d'écart)
  const fit = width > 0 ? Math.max(14, Math.floor((width + 2) / 5)) : allDays.length;
  const days = allDays.slice(-Math.min(fit, allDays.length));
  const known = days.filter((d) => d.uptime !== null);
  const bad = known.filter((d) => (d.uptime ?? 100) < 99.9).length;
  const h = hover !== null ? days[hover] : null;
  return (
    <div ref={ref} className={cn("relative", className)}>
      <div
        className="flex items-end gap-[2px]"
        style={{ height }}
        role="img"
        aria-label={tr("Disponibilité sur {length} jours : {1} jour(s) mesuré(s), {bad} jour(s) dégradé(s)", { length: days.length, "1": known.length, bad: bad })}
        onPointerLeave={() => setHover(null)}
      >
        {days.map((d, i) => {
          const tone = uptimeTone(d.uptime);
          return (
            <span
              key={d.day}
              onPointerEnter={() => setHover(i)}
              className={cn("h-full min-w-[2px] flex-1 rounded-[2px] transition-opacity", hover !== null && hover !== i && "opacity-60")}
              style={{ background: tone ? TONE_VAR[tone] : "var(--mm-border)" }}
            />
          );
        })}
      </div>
      {h && isClient && (
        <div
          className="pointer-events-none absolute bottom-[calc(100%+8px)] z-10 min-w-40 -translate-x-1/2 rounded-xl border border-line bg-elevated px-3 py-2 shadow-[var(--mm-shadow-md)]"
          style={{ left: `clamp(5rem, ${((hover! + 0.5) / days.length) * 100}%, calc(100% - 5rem))` }}
        >
          <p className="text-xs text-meta">{dateFormat(tr.locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(h.day))}</p>
          {h.uptime === null ? (
            <p className="text-sm text-body">{tr("Aucune mesure")}</p>
          ) : (
            <>
              <p className="text-base font-semibold text-h1">{formatPct(h.uptime, 2, tr.locale)}</p>
              {h.checks > 0 && (
                <p className="text-xs text-body">
                  {h.checks} {tr("contrôle(s)")}{h.avg !== null ? tr(" · {avg} ms en moyenne", { avg: h.avg }) : ""}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
