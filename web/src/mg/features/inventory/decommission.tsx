import { useState, useTransition } from "react";
import { CircleCheck, CircleDashed, Play, PowerOff, Trash2, Undo2 } from "lucide-react";
import {
  cancelDecommissionAction,
  decommissionStepAction,
  finishDecommissionAction,
  startDecommissionAction,
} from "@/actions/inventory";
import type { Decommission } from "@/lib/data/assets";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { inputClass } from "@/components/ui/form";
import { useToast } from "@/components/ui/toaster";
import { formatDateTime } from "@/lib/utils";

/** Starts the decommissioning of an item (it goes to "Retiré" with a checklist). */
export function DecommissionButton({ id, name }: { id: number; name: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <>
      <Button variant="secondary" icon={<PowerOff size={15} />} onClick={() => setOpen(true)}>
        Décommissionner
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Décommissionner « ${name} »`}
        description="L'élément passe à l'état « Retiré » et une liste d'étapes est préparée selon ce qui lui est lié (monitoring, hébergés, domaines, pare-feu…). Il n'est supprimé de l'inventaire qu'à la dernière étape."
      >
        <label className="grid gap-1.5 text-sm text-h2">
          Motif (facultatif)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Fin de vie, remplacement…" className={inputClass} />
        </label>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            icon={<PowerOff size={15} />}
            disabled={pending}
            aria-busy={pending}
            onClick={() =>
              start(async () => {
                const r = await startDecommissionAction(id, reason);
                if (!r.ok) toast("error", r.message);
                else setOpen(false);
              })
            }
          >
            Commencer
          </Button>
        </div>
      </Dialog>
    </>
  );
}

/** Steps of a decommissioning in progress: tick the manual ones, run the automatic ones, then delete. */
export function DecommissionPanel({ id, name, decommission: d, ips }: { id: number; name: string; decommission: Decommission; ips: string[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string>();
  const [, start] = useTransition();
  const done = d.steps.filter((s) => s.done).length;
  const ready = done === d.steps.length;

  const run = (key: string, fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      setBusy(key);
      const r = await fn();
      setBusy(undefined);
      if (!r.ok) toast("error", r.message);
    });

  return (
    <Card className="border-[var(--mm-yellow)]">
      <CardHeader
        overline="Décommissionnement"
        title={`${done}/${d.steps.length} étape(s) faite(s)`}
        actions={
          <Button variant="ghost" size="sm" icon={<Undo2 size={14} />} disabled={!!busy} onClick={() => run("cancel", () => cancelDecommissionAction(id))}>
            Annuler le décommissionnement
          </Button>
        }
      />
      <CardBody className="grid gap-4">
        <p className="text-sm text-body">
          Commencé {formatDateTime(d.started_at)}
          {d.reason ? <> · {d.reason}</> : null}
        </p>
        <ol className="grid gap-2">
          {d.steps.map((s, i) => (
            <li key={s.key} className="flex flex-col gap-2 rounded-xl border border-line-subtle bg-page px-4 py-3 sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-start gap-3">
                {s.auto ? (
                  s.done ? <CircleCheck size={18} className="mt-0.5 shrink-0 text-green" aria-hidden="true" /> : <CircleDashed size={18} className="mt-0.5 shrink-0 text-meta" aria-hidden="true" />
                ) : (
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0 accent-[var(--mm-accent)]"
                    checked={s.done}
                    disabled={!!busy}
                    onChange={(e) => run(s.key, () => decommissionStepAction(id, s.key, { done: e.target.checked }))}
                  />
                )}
                <span className="min-w-0">
                  <span className="block text-sm text-h1">
                    {i + 1}. {s.label}
                  </span>
                  {s.hint && <span className="mt-0.5 block text-xs text-meta">{s.hint}</span>}
                  {s.result && <span className="mt-0.5 block font-mono text-xs text-green">{s.result}</span>}
                </span>
              </label>
              {s.auto && !s.done && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Play size={13} />}
                  disabled={!!busy}
                  aria-busy={busy === s.key}
                  onClick={() => run(s.key, () => decommissionStepAction(id, s.key, { run: true }))}
                >
                  Exécuter
                </Button>
              )}
              {s.auto && s.done && <Badge tone="green">Fait</Badge>}
            </li>
          ))}
        </ol>
        {ready ? (
          <Alert kind="warning" title="Dernière étape : supprimer de l'inventaire">
            {ips.length > 0 ? `Les adresses ${ips.join(", ")} seront libérées. ` : ""}L'élément « {name} » disparaît de l'inventaire ; son historique reste dans les journaux.
          </Alert>
        ) : null}
        <div className="flex justify-end">
          <Button
            variant="danger"
            icon={<Trash2 size={15} />}
            disabled={!ready || !!busy}
            title={ready ? undefined : "Terminez d'abord toutes les étapes"}
            onClick={() => run("finish", () => finishDecommissionAction(id))}
          >
            Supprimer de l'inventaire
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
