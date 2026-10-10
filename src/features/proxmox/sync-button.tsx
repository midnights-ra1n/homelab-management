"use client";

import type { ReactNode } from "react";
import { syncProxmoxInventoryAction } from "@/actions/proxmox";
import { ActionButton } from "@/components/ui/action-button";

export function SyncProxmoxButton({ integrationId, icon }: { integrationId?: number; icon?: ReactNode }) {
  return (
    <ActionButton
      action={() => syncProxmoxInventoryAction(integrationId)}
      icon={icon}
      pendingLabel="Synchronisation…"
      title="Importer les VM et CT Proxmox dans l'inventaire"
    >
      Synchroniser Proxmox
    </ActionButton>
  );
}
