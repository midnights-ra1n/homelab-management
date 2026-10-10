"use client";

import { useTransition, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { useToast } from "./toaster";

/** Bouton qui exécute une server action et affiche son résultat en notification. */
export function ActionButton({
  action,
  children,
  pendingLabel,
  variant = "secondary",
  size = "md",
  icon,
  className,
  title,
  disabled,
}: {
  action: () => Promise<{ ok: boolean; message: string } | void>;
  children?: ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <Button
      variant={variant}
      size={size}
      icon={icon}
      className={className}
      title={title}
      aria-label={!children ? title : undefined}
      disabled={pending || disabled}
      aria-busy={pending}
      onClick={() =>
        start(async () => {
          const r = await action();
          if (r) toast(r.ok ? "success" : "error", r.message);
        })
      }
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
