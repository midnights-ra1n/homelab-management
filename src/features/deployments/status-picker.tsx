"use client";

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useOptimistic, useRef, useState, useTransition } from "react";
import { Popover } from "@/components/ui/popover";
import { setDeploymentStatusAction } from "@/actions/deployments";
import { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_META, TONE_TEXT_VAR, TONE_VAR, type DeploymentStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Badge d'état cliquable : ouvre une petite liste (fondu) pour changer l'état. */
export function StatusPicker({ id, status }: { id: number; status: DeploymentStatus }) {
  const [current, setCurrent] = useOptimistic(status);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const meta = DEPLOYMENT_STATUS_META[current];
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`État : ${meta.label}. Changer l'état`}
        className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-[filter] hover:brightness-110"
        style={{
          color: TONE_TEXT_VAR[meta.tone],
          background: `color-mix(in srgb, ${TONE_VAR[meta.tone]} 12%, transparent)`,
          borderColor: `color-mix(in srgb, ${TONE_VAR[meta.tone]} 35%, transparent)`,
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_VAR[meta.tone] }} />
        {meta.label}
        <ChevronDown size={12} className={cn("transition-transform duration-200", open && "rotate-180")} />
      </button>
      <Popover open={open} onClose={close} anchorRef={anchorRef} className="w-48" label="Changer l'état">
        <ul role="listbox" aria-label="Changer l'état">
          {DEPLOYMENT_STATUSES.map((s) => {
            const m = DEPLOYMENT_STATUS_META[s];
            return (
              <li key={s}>
                <button
                  type="button"
                  role="option"
                  aria-selected={s === current}
                  onClick={() => {
                    setOpen(false);
                    anchorRef.current?.focus();
                    if (s === current) return;
                    start(async () => {
                      setCurrent(s);
                      await setDeploymentStatusAction(id, s);
                    });
                  }}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm text-h2 transition-colors hover:bg-box hover:text-h1"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: TONE_VAR[m.tone] }} aria-hidden />
                  <span className="flex-1">{m.label}</span>
                  {s === current && <Check size={14} className="text-accent-text" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
}
