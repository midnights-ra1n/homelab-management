"use client";

import { Check, Plus, X } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { addStepAction, deleteStepAction, toggleStepAction } from "@/actions/deployments";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/form";
import type { DeploymentStep } from "@/lib/data/deployments";
import { cn } from "@/lib/utils";

/** Checklist interactive d'un déploiement (mise à jour optimiste). */
export function Checklist({ deploymentId, steps }: { deploymentId: number; steps: DeploymentStep[] }) {
  const [optimistic, toggle] = useOptimistic(steps, (state, id: number) =>
    state.map((s) => (s.id === id ? { ...s, done: s.done ? 0 : 1 } : s)),
  );
  const [, start] = useTransition();
  const [draft, setDraft] = useState("");
  const [adding, startAdd] = useTransition();

  const add = () => {
    const label = draft.trim();
    if (!label) return;
    setDraft("");
    startAdd(() => addStepAction(deploymentId, label));
  };

  return (
    <div>
      {optimistic.length === 0 && <p className="mb-3 text-sm text-meta">Aucune étape définie.</p>}
      <ol className="grid gap-1.5">
        {optimistic.map((s, i) => (
          <li key={s.id} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-page">
            <button
              type="button"
              role="checkbox"
              aria-checked={!!s.done}
              aria-label={s.label}
              onClick={() =>
                start(async () => {
                  toggle(s.id);
                  await toggleStepAction(s.id);
                })
              }
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-200",
                s.done ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-field hover:border-accent",
              )}
            >
              {!!s.done && <Check size={13} strokeWidth={3} />}
            </button>
            <span className="w-6 shrink-0 font-mono text-xs text-meta">{String(i + 1).padStart(2, "0")}</span>
            <span className={cn("flex-1 text-sm transition-colors", s.done ? "text-meta line-through" : "text-h2")}>{s.label}</span>
            <button
              type="button"
              onClick={() => start(() => deleteStepAction(s.id))}
              className="rounded-full p-1 text-meta opacity-0 transition-opacity hover:text-red focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Retirer l'étape « ${s.label} »`}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex gap-2">
        <input
          className={cn(inputClass, "py-2")}
          placeholder="Ajouter une étape…"
          aria-label="Ajouter une étape"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" size="icon" onClick={add} disabled={adding} aria-label="Ajouter l'étape" icon={<Plus size={16} />} />
      </div>
    </div>
  );
}
