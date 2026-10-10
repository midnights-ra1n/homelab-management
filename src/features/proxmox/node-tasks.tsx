"use client";

import { ListTree } from "lucide-react";
import { useState, useTransition } from "react";
import { nodeTasksAction } from "@/actions/proxmox";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { PveTask } from "@/lib/integrations/proxmox";

const fmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Journal des dernières tâches d'un nœud Proxmox. */
export function NodeTasks({ integrationId, node }: { integrationId: number; node: string }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<PveTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, start] = useTransition();

  const load = () =>
    start(async () => {
      const r = await nodeTasksAction(integrationId, node);
      if (r.ok) {
        setTasks(r.tasks);
        setError(null);
      } else setError(r.message);
    });

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<ListTree size={14} />}
        onClick={() => {
          setOpen(true);
          load();
        }}
      >
        Tâches
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Tâches · ${node}`} description="20 dernières tâches du nœud" size="lg">
        {error && <Alert kind="error">{error}</Alert>}
        {loading && !tasks && <p className="text-sm text-meta">Chargement…</p>}
        {tasks && (
          <ul className="grid gap-1.5">
            {tasks.map((t) => {
              const ok = t.status === "OK";
              const running = !t.endtime;
              return (
                <li key={t.upid} className="flex items-center gap-3 rounded-xl border border-line-subtle bg-box px-4 py-2.5">
                  <Badge tone={running ? "blue" : ok ? "green" : "red"}>{running ? "En cours" : ok ? "OK" : "Erreur"}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-sm text-h2">
                      {t.type}
                      {t.id ? ` · ${t.id}` : ""}
                    </span>
                    {!ok && !running && t.status && <span className="block truncate text-xs text-red">{t.status}</span>}
                  </span>
                  <span className="shrink-0 text-right font-mono text-xs text-meta">
                    {fmt.format(new Date(t.starttime * 1000))}
                    <br />
                    {t.user}
                  </span>
                </li>
              );
            })}
            {tasks.length === 0 && <p className="text-sm text-meta">Aucune tâche récente.</p>}
          </ul>
        )}
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={load} disabled={loading}>
            {loading ? "Actualisation…" : "Actualiser"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
