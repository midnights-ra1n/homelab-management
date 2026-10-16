
import { useOptimistic, useTransition } from "react";
import { setDeploymentStatusAction } from "@/actions/deployments";
import { DEPLOYMENT_STATUSES, DEPLOYMENT_STATUS_META, TONE_VAR, type DeploymentStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

export function StatusSwitcher({ id, status }: { id: number; status: DeploymentStatus }) {
  const tr = useT();
  const [current, setCurrent] = useOptimistic(status);
  const [, start] = useTransition();
  return (
    <div role="radiogroup" aria-label={tr("État du déploiement")} className="flex flex-wrap gap-1.5">
      {DEPLOYMENT_STATUSES.map((s) => {
        const meta = DEPLOYMENT_STATUS_META[s];
        const active = s === current;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() =>
              start(async () => {
                setCurrent(s);
                await setDeploymentStatusAction(id, s);
              })
            }
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "text-h1" : "border-line text-body hover:border-line-strong hover:text-h1",
            )}
            style={
              active
                ? {
                    borderColor: `color-mix(in srgb, ${TONE_VAR[meta.tone]} 60%, transparent)`,
                    background: `color-mix(in srgb, ${TONE_VAR[meta.tone]} 16%, transparent)`,
                  }
                : undefined
            }
          >
            <span className="h-2 w-2 rounded-full" style={{ background: TONE_VAR[meta.tone] }} aria-hidden="true" />
            {tr(meta.label)}
          </button>
        );
      })}
    </div>
  );
}
