
import { guestActionAction } from "@/actions/proxmox";
import { ActionButton } from "@/components/ui/action-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useT } from "@/i18n/client";
import { ACTIONS } from "./guest-table";

/** Boutons d'alimentation d'un invité (page détaillée) : démarrage direct, le reste avec confirmation. */
export function GuestPowerBar({ integrationId, node, type, vmid, status, name }: { integrationId: number; node: string; type: "qemu" | "lxc"; vmid: number; status: string; name: string }) {
  const tr = useT();
  return (
    <>
      {ACTIONS.filter((a) => a.when(status) && !(type === "lxc" && (a.action === "suspend" || a.action === "resume"))).map((a) => {
        const act = () => guestActionAction(integrationId, node, type, vmid, a.action);
        return a.action === "start" || a.action === "resume" ? (
          <ActionButton key={a.action} action={act} variant="primary" icon={<a.icon size={15} />}>
            {tr(a.label)}
          </ActionButton>
        ) : (
          <ConfirmButton
            key={a.action}
            action={act}
            variant="secondary"
            size="md"
            icon={<a.icon size={15} />}
            label={a.label}
            title={`${tr(a.label)} ?`}
            confirmLabel={a.label}
            pendingLabel="Envoi…"
            message={`${tr(a.label)} ${name} (${vmid}).${a.action === "stop" ? tr(" L'arrêt forcé équivaut à couper l'alimentation.") : ""}`}
          >
            {tr(a.label)}
          </ConfirmButton>
        );
      })}
    </>
  );
}
