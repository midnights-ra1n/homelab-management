import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { syncTasksAction } from "@/actions/tasks";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { useT } from "@/i18n/client";

/** Synchronise tout de suite avec la liste Nextcloud (et donc Rappels), sans attendre la minute. */
export function TaskSync() {
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      size="md"
      icon={<RefreshCw size={15} />}
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        const r = await syncTasksAction();
        setBusy(false);
        toast(r.ok ? "success" : "error", r.message);
      }}
    >
      {tr("Synchroniser")}
    </Button>
  );
}
