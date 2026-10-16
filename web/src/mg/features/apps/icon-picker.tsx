
/* eslint-disable @next/next/no-img-element */
import { Search, Trash2, Upload } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { deleteUploadedIconAction, searchIconsAction, uploadIconAction } from "@/actions/shortcuts";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/form";
import { ICON_PROVIDERS } from "@/lib/icons";
import type { IconType, UploadedIcon } from "@/lib/data/shortcuts";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { useT } from "@/i18n/client";

const TABS: { value: IconType; label: string }[] = [
  { value: "dashboard", label: "Dashboard Icons" },
  { value: "selfhst", label: "selfh.st" },
  { value: "upload", label: "Mes icônes" },
  { value: "url", label: "URL" },
  { value: "none", label: "Aucune" },
];

/** Sélecteur d'icône : fournisseurs en ligne, icônes téléversées ou URL libre. */
export function IconPicker({
  defaultType = "dashboard",
  defaultValue = "",
  uploads: initialUploads,
  suggestion,
}: {
  defaultType?: IconType;
  defaultValue?: string;
  uploads: UploadedIcon[];
  suggestion?: string;
}) {
  const tr = useT();
  const [type, setType] = useState<IconType>(defaultValue ? defaultType : "dashboard");
  const [value, setValue] = useState(defaultValue);
  const [query, setQuery] = useState(defaultValue && (defaultType === "dashboard" || defaultType === "selfhst") ? defaultValue : "");
  const [results, setResults] = useState<{ provider: string; name: string; label: string }[]>([]);
  const [searching, startSearch] = useTransition();
  const [uploads, setUploads] = useState(initialUploads);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();

  // Recherche avec anti-rebond ; suggère à partir du nom du raccourci
  const effectiveQuery = query || suggestion || "";
  useEffect(() => {
    if (type !== "dashboard" && type !== "selfhst") return;
    const t = setTimeout(() => {
      startSearch(async () => setResults(await searchIconsAction(effectiveQuery.toLowerCase(), type)));
    }, 250);
    return () => clearTimeout(t);
  }, [effectiveQuery, type]);

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("label", file.name.replace(/\.[^.]+$/, ""));
    startUpload(async () => {
      const r = await uploadIconAction({}, fd);
      setUploadError(r.errors?.file ?? null);
      if (r.icon) {
        const icon = r.icon;
        setUploads((u) => [icon, ...u.filter((x) => x.id !== icon.id)]);
        setValue(icon.filename);
      }
    });
  };

  return (
    <div className="rounded-2xl border border-line bg-page p-4">
      <input type="hidden" name="icon_type" value={value || type === "none" ? type : "none"} />
      <input type="hidden" name="icon_value" value={type === "none" ? "" : value} />

      <div className="mb-4 flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line-subtle bg-box">
          <AppIcon type={value ? type : "none"} value={value} name={suggestion || "?"} size={36} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-h1">{tr("Icône")}</p>
          <p className="truncate font-mono text-xs text-meta">{value ? `${type} · ${value}` : tr("Initiales par défaut")}</p>
        </div>
      </div>

      <div role="tablist" aria-label={tr("Source de l'icône")} className="mb-4 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={type === t.value}
            onClick={() => {
              setType(t.value);
              if (t.value !== type) setValue("");
            }}
            className={cn(
              "rounded-full px-3 py-1.5 font-mono text-xs transition-colors",
              type === t.value ? "bg-accent text-on-accent" : "text-body hover:bg-box hover:text-h1",
            )}
          >
            {tr(t.label)}
          </button>
        ))}
      </div>

      {(type === "dashboard" || type === "selfhst") && (
        <div>
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-meta" aria-hidden="true" />
            <input
              className={cn(inputClass, "pl-10")}
              placeholder={tr("Rechercher dans {label}…", { label: ICON_PROVIDERS[type].label })}
              aria-label={tr("Rechercher une icône")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="mt-3 grid max-h-56 grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 overflow-y-auto pr-1" aria-busy={searching}>
            {results.map((r) => (
              <button
                key={`${r.provider}-${r.name}`}
                type="button"
                onClick={() => setValue(r.name)}
                aria-pressed={value === r.name}
                title={r.label}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                  value === r.name ? "border-accent bg-accent-soft" : "border-transparent hover:border-line hover:bg-box",
                )}
              >
                <img src={ICON_PROVIDERS[type].url(r.name)} alt="" width={32} height={32} loading="lazy" className="h-8 w-8 object-contain" />
                <span className="w-full truncate text-center text-[0.65rem] text-meta">{r.name}</span>
              </button>
            ))}
            {!searching && results.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-meta">{tr("Aucune icône trouvée (ou index injoignable).")}</p>
            )}
          </div>
          <p className="mt-2 text-xs text-meta">
            {tr("Source :")}{" "}
            <a href={ICON_PROVIDERS[type].homepage} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
              {tr(ICON_PROVIDERS[type].label)}
            </a>{" "}
            {tr("via jsDelivr")}</p>
        </div>
      )}

      {type === "upload" && (
        <div className="grid gap-3">
          <div className="grid max-h-48 grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 overflow-y-auto">
            {uploads.map((u) => (
              <div key={u.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setValue(u.filename)}
                  aria-pressed={value === u.filename}
                  title={u.label}
                  className={cn(
                    "flex w-full flex-col items-center gap-1.5 rounded-xl border p-2 transition-colors",
                    value === u.filename ? "border-accent bg-accent-soft" : "border-transparent hover:border-line hover:bg-box",
                  )}
                >
                  <AppIcon type="upload" value={u.filename} name={u.label} size={32} />
                  <span className="w-full truncate text-center text-[0.65rem] text-meta">{u.label}</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await deleteUploadedIconAction(u.id);
                    setUploads((x) => x.filter((i) => i.id !== u.id));
                    if (value === u.filename) setValue("");
                  }}
                  className="absolute -right-1 -top-1 hidden rounded-full border border-line bg-elevated p-1 text-meta hover:text-red group-hover:block"
                  aria-label={tr("Supprimer l'icône {label}", { label: u.label })}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          {/* Formulaire imbriqué interdit : on soumet l'upload séparément via formAction */}
          <div className="flex flex-col gap-2 rounded-xl border border-dashed border-line p-3 sm:flex-row sm:items-center">
            <input
              id="icon-upload"
              type="file"
              accept="image/png,image/svg+xml,image/webp,image/jpeg,image/x-icon,image/gif"
              className="min-w-0 flex-1 text-sm text-body file:mr-3 file:rounded-lg file:border file:border-line-strong file:bg-box file:px-3 file:py-1.5 file:text-sm file:text-h2"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload(file);
                e.target.value = "";
              }}
            />
            <span className="flex items-center gap-1.5 text-xs text-meta">
              <Upload size={13} aria-hidden="true" /> {uploading ? tr("Envoi…") : tr("PNG, SVG, WebP, JPG · 1 Mo max")}
            </span>
          </div>
          {uploadError && <p className="text-xs text-red">✕ {uploadError}</p>}
        </div>
      )}

      {type === "url" && (
        <input
          className={inputClass}
          placeholder="https://exemple.lan/favicon.svg"
          aria-label={tr("URL de l'icône")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}

      {type === "none" && <p className="text-sm text-meta">{tr("Les initiales du raccourci seront affichées.")}</p>}

      {value && type !== "none" && (
        <Button variant="subtle" size="sm" className="mt-3" onClick={() => setValue("")}>
          {tr("Retirer l'icône")}</Button>
      )}
    </div>
  );
}
