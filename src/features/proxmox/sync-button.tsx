"use client";

import type { ReactNode } from "react";
import { syncProxmoxInventoryAction } from "@/actions/proxmox";
import { ActionButton } from "@/components/ui/action-button";
import { useT } from "@/i18n/client";

export function SyncProxmoxButton({ integrationId, icon }: { integrationId?: number; icon?: ReactNode }) {
  const tr = useT();
  return (
    <ActionButton
      action={() => syncProxmoxInventoryAction(integrationId)}
      icon={icon}
      pendingLabel={tr("Synchronisation…")}
      title={tr("Importer les VM et CT Proxmox dans l'inventaire")}
    >
      {tr("Synchroniser Proxmox")}</ActionButton>
  );
}
