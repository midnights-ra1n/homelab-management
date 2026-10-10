"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Dialog } from "./dialog";

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
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant={variant} size={size} icon={icon} onClick={() => setOpen(true)} aria-label={children ? undefined : label} title={label}>
        {children}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} size="sm">
        <p className="text-sm leading-relaxed text-body">{message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await action();
                setOpen(false);
              })
            }
          >
            {pending ? "Suppression…" : confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
