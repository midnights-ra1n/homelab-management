"use client";

import Link from "next/link";
import { LogOut, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/actions/auth";
import { cn } from "@/lib/utils";
import { ThemeSwitch } from "./theme-switch";

function Avatar({ username }: { username: string }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line-accent bg-accent-soft font-mono text-xs font-semibold uppercase text-accent-text">
      {username.slice(0, 2)}
    </span>
  );
}

/** Menu du compte (desktop) : ouverture / fermeture en fondu. */
export function UserDropdown({ username, canLogout }: { username: string; canLogout: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Compte ${username}`}
        className="rounded-full transition-[box-shadow] duration-200 hover:shadow-[0_0_0_3px_var(--mm-accent-soft)]"
      >
        <Avatar username={username} />
      </button>
      <div
        role="menu"
        inert={!open}
        className={cn(
          "absolute right-0 top-[calc(100%+0.9rem)] w-64 origin-top-right rounded-2xl border border-line bg-elevated p-2 shadow-[var(--mm-shadow-popover)]",
          "transition-[opacity,scale,translate] duration-200 ease-out",
          open ? "translate-y-0 scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-95 opacity-0",
        )}
      >
        <p className="px-3 pb-2 pt-1.5 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
          Connecté · <span className="normal-case tracking-normal text-h2">{username}</span>
        </p>
        <div className="px-2 pb-2">
          <ThemeSwitch className="w-full justify-between" />
        </div>
        <Link
          role="menuitem"
          href="/parametres"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 rounded-full px-3 py-2.5 text-sm text-h2 transition-colors hover:bg-box hover:text-h1"
        >
          <Settings size={16} className="text-meta" /> Paramètres
        </Link>
        {canLogout && (
          <form action={logoutAction}>
            <button
              role="menuitem"
              type="submit"
              className="flex w-full items-center gap-2.5 rounded-full px-3 py-2.5 text-sm text-h2 transition-colors hover:bg-box hover:text-red"
            >
              <LogOut size={16} className="text-meta" /> Se déconnecter
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Ligne de compte dans le menu mobile. */
export function UserRow({ username, canLogout }: { username: string; canLogout: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-full border border-line px-2 py-2">
      <span className="flex items-center gap-3 text-sm text-h2">
        <Avatar username={username} />
        {username}
      </span>
      {canLogout && (
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-10 items-center gap-2 rounded-full px-4 text-sm text-body transition-colors hover:bg-box hover:text-red"
          >
            <LogOut size={16} /> Se déconnecter
          </button>
        </form>
      )}
    </div>
  );
}
