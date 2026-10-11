"use client";

import { Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { usePathname, useT } from "@/i18n/client";

type SelectFilter = { name: string; label: string; options: { value: string; label: string }[] };

/** Recherche + filtres synchronisés avec l'URL (partageable, rechargeable). */
export function FilterBar({
  placeholder = "Rechercher…",
  selects = [],
  className,
}: {
  placeholder?: string;
  selects?: SelectFilter[];
  className?: string;
}) {
  const tr = useT();
  placeholder = tr(placeholder);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    start(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => update("q", q.trim()), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Raccourci clavier « / » pour la recherche
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(target.tagName) && !target.isContentEditable) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", className)} aria-busy={pending}>
      <div className="relative flex-1">
        <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-meta" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="field w-full rounded-xl py-2.5 pl-11 pr-12 text-base sm:text-sm"
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-meta hover:text-h1"
            aria-label={tr("Effacer la recherche")}
          >
            <X size={15} />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-line px-1.5 font-mono text-[0.7rem] text-meta sm:block">
            /
          </kbd>
        )}
      </div>
      {selects.map((s) => (
        <select
          key={s.name}
          aria-label={s.label}
          value={params.get(s.name) ?? ""}
          onChange={(e) => update(s.name, e.target.value)}
          className="field rounded-xl px-4 py-2.5 text-base sm:w-auto sm:text-sm"
        >
          <option value="">{s.label}</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
