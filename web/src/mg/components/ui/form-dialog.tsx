
import { useState, type ReactNode } from "react";
import type { FormState } from "@/lib/validation";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Dialog } from "./dialog";
import { Alert } from "./alert";
import { ActionForm, SubmitButton, useFormMessage } from "./form";
import { useToast } from "./toaster";
import { useT } from "@/i18n/client";

/** Bouton + modale + formulaire de server action ; se ferme et notifie au succès. */
export function FormDialog({
  title,
  description,
  action,
  children,
  trigger,
  triggerVariant = "primary",
  triggerSize = "md",
  triggerIcon,
  triggerLabel,
  submitLabel = "Enregistrer",
  size = "md",
}: {
  title: string;
  description?: string;
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  trigger?: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  triggerIcon?: ReactNode;
  triggerLabel?: string;
  submitLabel?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const tr = useT();
  submitLabel = tr(submitLabel);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const toast = useToast();
  return (
    <>
      <Button
        variant={triggerVariant}
        size={triggerSize}
        icon={triggerIcon}
        onClick={() => {
          setKey((k) => k + 1);
          setOpen(true);
        }}
        aria-label={!trigger ? triggerLabel : undefined}
        title={triggerLabel}
      >
        {trigger}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} description={description} size={size}>
        <ActionForm
          key={key}
          action={action}
          showMessage={false}
          onSuccess={(s) => {
            setOpen(false);
            if (s.message) toast("success", s.message);
          }}
          className="grid gap-5"
        >
          <FormError />
          {children}
          <div className="mt-2 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tr("Annuler")}</Button>
            <SubmitButton>{submitLabel}</SubmitButton>
          </div>
        </ActionForm>
      </Dialog>
    </>
  );
}

function FormError() {
  const { message, ok } = useFormMessage();
  return message && !ok ? <Alert kind="error">{message}</Alert> : null;
}
