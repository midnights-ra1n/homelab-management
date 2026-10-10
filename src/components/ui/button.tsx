import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "icon" | "icon-sm";

const base =
  "inline-flex items-center justify-center gap-2 [-webkit-tap-highlight-color:transparent] touch-manipulation whitespace-nowrap font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 select-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent font-semibold hover:bg-accent-hover active:bg-accent-active",
  secondary: "border border-line-strong text-h2 hover:bg-box",
  ghost: "text-accent-text hover:bg-accent-soft",
  danger: "bg-red text-on-accent font-semibold hover:brightness-110 active:brightness-95 transition-[filter]",
  subtle: "text-body hover:text-h1 hover:bg-elevated",
};

const sizes: Record<ButtonSize, string> = {
  sm: "rounded-full px-3.5 py-1.5 text-xs",
  md: "rounded-full px-5 py-2.5 text-sm",
  icon: "rounded-full h-10 w-10 text-sm",
  "icon-sm": "rounded-full h-8 w-8 text-xs",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
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
