
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { searchAssetsAction } from "@/actions/inventory";
import { StatusDot } from "@/components/ui/badge";
import { KindIcon } from "@/components/kind-icon";
import { ASSET_KIND_META, ASSET_STATUS_META, type AssetKind, type AssetStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { NAV_ITEMS } from "./nav-items";

type Hit = { id: number; kind: AssetKind; name: string; hostname: string; ip: string | null; status: AssetStatus };
type Item = { key: string; href: string; label: string; detail?: string; icon: React.ReactNode; status?: AssetStatus };

const OPEN_EVENT = "hm-search";
/** Ouvre la palette depuis un bouton (sidebar, feuille mobile). */
export const openSearch = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** Recherche globale (⌘K / Ctrl+K) : pages et inventaire (nom, hostname, IP, MAC, n° de série, tags). */
export function CommandPalette() {
  const tr = useT();
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ for: string; items: Hit[] }>({ for: "", items: [] });
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (!query) return;
    let alive = true;
    const t = setTimeout(() => searchAssetsAction(query).then((items) => alive && setHits({ for: query, items })), 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const query = q.trim().toLowerCase();
  const pages = [...NAV_ITEMS, { href: "/parametres", label: "Paramètres", short: "", icon: Settings }]
    .filter((p) => !query || tr(p.label).toLowerCase().includes(query))
    .map<Item>((p) => ({ key: `p${p.href}`, href: p.href, label: tr(p.label), detail: tr("Page"), icon: <p.icon size={16} /> }));
  const assets = (hits.for === q.trim() ? hits.items : []).map<Item>((a) => ({
    key: `a${a.id}`,
    href: `/inventaire/${a.id}`,
    label: a.name,
    detail: [a.ip, a.hostname, tr(ASSET_KIND_META[a.kind].label)].filter(Boolean).join(" · "),
    icon: <KindIcon kind={a.kind} size={16} />,
    status: a.status,
  }));
  const items = query ? [...assets, ...pages] : pages;
  const current = Math.min(active, Math.max(0, items.length - 1));

  const go = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  };

  return (
    <dialog
      ref={ref}
      onClose={() => {
        setOpen(false);
        setQ("");
        setActive(0);
      }}
      onClick={(e) => e.target === ref.current && setOpen(false)}
      aria-label={tr("Recherche globale")}
      className="mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-[560px] rounded-[14px] border border-line bg-elevated p-0 text-h2 shadow-[var(--mm-shadow-lg)]"
    >
      {open && (
        <div
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((current + 1) % Math.max(1, items.length));
            else if (e.key === "ArrowUp") setActive((current - 1 + items.length) % Math.max(1, items.length));
            else if (e.key === "Enter") go(items[current]);
            else return;
            e.preventDefault();
          }}
        >
          <div className="flex items-center gap-3 border-b border-line px-4">
            <Search size={16} className="shrink-0 text-accent-text" aria-hidden="true" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              placeholder={tr("Nom, IP, MAC, n° de série, page…")}
              aria-label={tr("Rechercher")}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-results"
              aria-activedescendant={items[current] ? `palette-${items[current].key}` : undefined}
              className="h-12 min-w-0 flex-1 bg-transparent text-base text-h1 outline-none placeholder:text-meta"
            />
            <kbd className="rounded-full border border-line px-2 font-mono text-[0.7rem] text-meta">Esc</kbd>
          </div>
          <ul id="palette-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
            {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-meta">{tr("Aucun résultat")}</li>}
            {items.map((item, i) => (
              <li
                key={item.key}
                id={`palette-${item.key}`}
                role="option"
                aria-selected={i === current}
                onMouseMove={() => setActive(i)}
                onClick={() => go(item)}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-[6px] px-3 text-sm",
                  i === current ? "bg-hover text-h1" : "text-h2",
                )}
              >
                <span className={cn("shrink-0", i === current ? "text-accent-text" : "text-meta")}>{item.icon}</span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{item.label}</span>
                  {item.status && <StatusDot tone={ASSET_STATUS_META[item.status].tone} className="scale-75" />}
                </span>
                {item.detail && <span className="max-w-[45%] truncate font-mono text-xs text-meta">{item.detail}</span>}
                {i === current && <CornerDownLeft size={14} className="shrink-0 text-meta" aria-hidden="true" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  );
}
