"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Dialog } from "./dialog";
import { useToast } from "./toaster";
import { useT } from "@/i18n/client";

/** Bouton qui demande confirmation avant d'exécuter une action destructrice. */
export function ConfirmButton({
  action,
  title = "Confirmer la suppression",
  message,
  confirmLabel = "Supprimer",
  children,
  variant = "subtle",
  size = "icon-sm",
  icon = <Trash2 size={15} />,
  label = "Supprimer",
  pendingLabel = "Suppression…",
}: {
  action: () => Promise<unknown>;
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  label?: string;
  pendingLabel?: string;
}) {
  const tr = useT();
  label = tr(label);
  confirmLabel = tr(confirmLabel);
  title = tr(title);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <>
      <Button variant={variant} size={size} icon={icon} onClick={() => setOpen(true)} aria-label={children ? undefined : label} title={label}>
        {children}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} size="sm">
        <p className="text-sm leading-relaxed text-body">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {tr("Annuler")}</Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await action();
                setOpen(false);
                // Actions qui renvoient { ok, message } (Proxmox…) : on affiche le résultat
                if (r && typeof r === "object" && "ok" in r && "message" in r) toast(r.ok ? "success" : "error", tr(String(r.message)));
              })
            }
          >
            {pending ? tr(pendingLabel) : confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
