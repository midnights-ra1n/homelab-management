import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost" | "subtle";
export type ButtonSize = "sm" | "md" | "icon" | "icon-sm";

/** Boutons pleins en pilule de la charte (.mm-btn) ; « subtle » = ghost. */
const variants: Record<ButtonVariant, string> = {
  primary: "mm-btn--primary",
  secondary: "mm-btn--secondary",
  ghost: "mm-btn--ghost",
  danger: "mm-btn--danger",
  "danger-ghost": "mm-btn--danger-ghost",
  subtle: "mm-btn--ghost",
};

const sizes: Record<ButtonSize, string> = {
  sm: "mm-btn--sm",
  md: "",
  icon: "mm-btn--icon",
  "icon-sm": "mm-btn--icon mm-btn--sm",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn("mm-btn touch-manipulation", variants[variant], sizes[size], className);
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode };

export function Button({ variant, size, icon, className, children, type = "button", ...props }: Common & ComponentProps<"button">) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...props}>
      {icon}
      {children}
    </button>
  );
}

export function ButtonLink({ variant, size, icon, className, children, ...props }: Common & ComponentProps<typeof Link>) {
  return (
    <Link className={buttonClass(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}
