import { use, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncNowAction } from "@/actions/integrations";
import { getSetting } from "@/lib/data/settings";
import { write } from "@/lib/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

/** Inventory ↔ monitoring sync: each host with the agent is linked to (or creates) an inventory item. */
export function InventorySync() {
  const enabled = use(getSetting("inventory_sync", "true")) === "true";
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-line-subtle bg-box px-4 py-3 sm:flex-row sm:items-center">
      <label className="flex flex-1 items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--mm-accent)]"
          checked={enabled}
          disabled={pending}
          onChange={(e) => start(() => write("PUT", "/api/settings", { inventory_sync: String(e.target.checked) }))}
        />
        <span>
          <span className="block text-h1">Synchroniser l'inventaire avec le monitoring</span>
          <span className="block text-xs text-meta">
            Toutes les 2 minutes : chaque hôte équipé de l'agent est relié à un élément de l'inventaire (créé s'il manque) et son matériel (CPU, RAM, disques, interfaces, IP, système) est mis à jour.
          </span>
        </span>
      </label>
      <Button
        variant="secondary"
        size="sm"
        icon={<RefreshCw size={14} />}
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          const r = await syncNowAction().catch((e: Error) => ({ ok: false, message: e.message }));
          setBusy(false);
          toast(r.ok ? "success" : "error", r.message);
        }}
      >
        Synchroniser maintenant
      </Button>
    </div>
  );
}
