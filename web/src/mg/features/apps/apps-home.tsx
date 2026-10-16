
import { ArrowDown, ArrowUp, FolderPlus, LayoutGrid, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import {
  deleteGroupAction,
  deleteShortcutAction,
  moveGroupAction,
  probeShortcutsAction,
  reorderShortcutsAction,
  saveGroupAction,
  saveShortcutAction,
} from "@/actions/shortcuts";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField, Switch, TextField } from "@/components/ui/form";
import type { Shortcut, ShortcutGroup, UploadedIcon } from "@/lib/data/shortcuts";
import { cn } from "@/lib/utils";
import { AppIcon } from "./app-icon";
import { IconPicker } from "./icon-picker";
import { useT } from "@/i18n/client";

type Probe = { up: boolean; status?: number; ms: number };
type Props = {
  shortcuts: Shortcut[];
  groups: ShortcutGroup[];
  uploads: UploadedIcon[];
  assets: { id: number; display_name: string }[];
};

const UNGROUPED = 0;

export function AppsHome({ shortcuts, groups, uploads, assets }: Props) {
  const tr = useT();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const [items, reorder] = useOptimistic(shortcuts, (state, m: { groupId: number | null; ids: number[] }) => {
    const moved = new Map(m.ids.map((id, i) => [id, i]));
    return state
      .map((s) => (moved.has(s.id) ? { ...s, group_id: m.groupId, position: moved.get(s.id)! } : s))
      .sort((a, b) => a.position - b.position);
  });
  const [, start] = useTransition();
  const [dragId, setDragId] = useState<number | null>(null);

  // Vérifie la disponibilité des services (au chargement puis chaque minute)
  useEffect(() => {
    const urls = shortcuts.filter((s) => s.status_check).map((s) => s.url);
    if (!urls.length) return;
    let alive = true;
    const run = () => probeShortcutsAction(urls).then((r) => alive && setProbes(r));
    run();
    const t = setInterval(run, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [shortcuts]);

  // « / » pour chercher, Échap pour effacer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(target.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => `${s.name} ${s.description} ${s.url}`.toLowerCase().includes(q));
  }, [items, query]);

  const sections = [
    ...groups.map((g) => ({ id: g.id, name: g.name, group: g })),
    { id: UNGROUPED, name: groups.length ? tr("Sans groupe") : tr("Applications"), group: null },
  ]
    .map((s) => ({ ...s, items: filtered.filter((i) => (i.group_id ?? UNGROUPED) === s.id) }))
    .filter((s) => s.items.length > 0 || (editing && s.group));

  const drop = (groupId: number, beforeId: number | null) => {
    if (dragId === null) return;
    const ids = items.filter((i) => (i.group_id ?? UNGROUPED) === groupId && i.id !== dragId).map((i) => i.id);
    const index = beforeId ? ids.indexOf(beforeId) : -1;
    ids.splice(index === -1 ? ids.length : index, 0, dragId);
    const gid = groupId === UNGROUPED ? null : groupId;
    start(async () => {
      reorder({ groupId: gid, ids });
      await reorderShortcutsAction(gid, ids);
    });
    setDragId(null);
  };

  const upCount = Object.values(probes).filter((p) => p.up).length;
  const checked = Object.keys(probes).length;

  return (
    <div className="grid grid-cols-1 gap-8 xl:gap-10">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-meta" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0]) window.open(filtered[0].url, filtered[0].new_tab ? "_blank" : "_self");
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={tr("Rechercher une application… (Entrée pour ouvrir)")}
            aria-label={tr("Rechercher une application")}
            className="field w-full rounded-full py-3.5 pl-13 pr-14 text-base"
          />
          <kbd className="pointer-events-none absolute right-5 top-1/2 hidden -translate-y-1/2 rounded-md border border-line px-1.5 font-mono text-[0.7rem] text-meta sm:block">
            /
          </kbd>
        </div>
        <div className="flex items-center gap-2">
          {checked > 0 && (
            <span className="mr-2 font-mono text-xs text-meta">
              {upCount}/{checked} {tr("en ligne")}</span>
          )}
          <Button
            variant={editing ? "primary" : "secondary"}
            onClick={() => setEditing((e) => !e)}
            icon={<LayoutGrid size={16} />}
            aria-pressed={editing}
          >
            {editing ? tr("Terminer") : tr("Organiser")}
          </Button>
          <GroupDialog />
          <ShortcutDialog groups={groups} uploads={uploads} assets={assets} />
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid size={22} />}
          title={tr("Aucun raccourci")}
          action={<ShortcutDialog groups={groups} uploads={uploads} assets={assets} />}
        >
          {tr("Ajoute des raccourcis vers tes applications auto-hébergées, avec leur icône et une vérification de disponibilité.")}</EmptyState>
      ) : sections.length === 0 ? (
        <p className="py-12 text-center text-sm text-meta">{tr("Aucune application ne correspond à « ")}{query} ».</p>
      ) : (
        sections.map((section, si) => (
          <section
            key={section.id}
            aria-label={section.name}
            onDragOver={(e) => editing && dragId !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const target = (e.target as HTMLElement).closest<HTMLElement>("[data-shortcut-id]");
              drop(section.id, target ? Number(target.dataset.shortcutId) : null);
            }}
            className={cn(editing && "rounded-3xl border border-dashed border-line p-4")}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-meta">
                {section.name} <span className="ml-1 text-line-strong">{section.items.length}</span>
              </h2>
              {editing && section.group && (
                <div className="flex items-center">
                  <Button
                    variant="subtle"
                    size="icon-sm"
                    aria-label={tr("Monter le groupe")}
                    disabled={si === 0}
                    onClick={() => start(() => moveGroupAction(section.group!.id, -1))}
                    icon={<ArrowUp size={14} />}
                  />
                  <Button
                    variant="subtle"
                    size="icon-sm"
                    aria-label={tr("Descendre le groupe")}
                    disabled={si >= groups.length - 1}
                    onClick={() => start(() => moveGroupAction(section.group!.id, 1))}
                    icon={<ArrowDown size={14} />}
                  />
                  <GroupDialog group={section.group} />
                  <ConfirmButton
                    action={() => deleteGroupAction(section.group!.id)}
                    message={tr("Supprimer le groupe « {name} » ? Ses raccourcis seront conservés sans groupe.", { name: section.name })}
                  />
                </div>
              )}
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {section.items.map((s) => {
                const probe = probes[s.url];
                return (
                  <li
                    key={s.id}
                    data-shortcut-id={s.id}
                    draggable={editing}
                    onDragStart={() => setDragId(s.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn("group relative", dragId === s.id && "opacity-40", editing && "cursor-grab")}
                  >
                    <a
                      href={editing ? undefined : s.url}
                      target={s.new_tab ? "_blank" : undefined}
                      rel="noreferrer"
                      aria-disabled={editing}
                      className={cn(
                        "flex h-full items-center gap-4 rounded-2xl border border-line-subtle bg-box p-4 transition-all duration-200",
                        !editing && "hover:-translate-y-0.5 hover:border-line-accent hover:shadow-[0_0_24px_2px_var(--mm-accent-soft)]",
                      )}
                    >
                      <AppIcon type={s.icon_type} value={s.icon_value} name={s.name} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium text-h1">{s.name}</span>
                          {s.status_check ? (
                            <span
                              className={cn(
                                "h-2 w-2 shrink-0 rounded-full",
                                !probe ? "bg-line-strong" : probe.up ? "bg-green" : "bg-red",
                              )}
                              title={!probe ? tr("Vérification…") : probe.up ? tr("En ligne · {ms} ms", { ms: probe.ms }) : tr("Injoignable")}
                              aria-label={!probe ? tr("Vérification en cours") : probe.up ? tr("En ligne") : tr("Injoignable")}
                            />
                          ) : null}
                        </span>
                        <span className="block truncate text-xs text-meta">
                          {s.description || s.url.replace(/^https?:\/\//, "")}
                        </span>
                      </span>
                      {probe?.up && !editing && (
                        <span className="hidden font-mono text-[0.65rem] text-meta group-hover:block">{probe.ms} {tr("ms")}</span>
                      )}
                    </a>
                    {editing && (
                      <div className="absolute right-2 top-2 flex rounded-lg border border-line bg-elevated">
                        <ShortcutDialog shortcut={s} groups={groups} uploads={uploads} assets={assets} />
                        <ConfirmButton action={() => deleteShortcutAction(s.id)} message={tr("Supprimer le raccourci « {name} » ?", { name: s.name })} />
                      </div>
                    )}
                  </li>
                );
              })}
              {editing && section.items.length === 0 && (
                <li className="col-span-full rounded-2xl border border-dashed border-line p-6 text-center text-sm text-meta">
                  {tr("Glisse des raccourcis ici")}</li>
              )}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ShortcutDialog({
  shortcut,
  groups,
  uploads,
  assets,
}: {
  shortcut?: Shortcut;
  groups: ShortcutGroup[];
  uploads: UploadedIcon[];
  assets: { id: number; display_name: string }[];
}) {
  const tr = useT();
  return (
    <FormDialog
      title={shortcut ? tr("Modifier « {name} »", { name: shortcut.name }) : tr("Nouveau raccourci")}
      action={saveShortcutAction.bind(null, shortcut?.id ?? null)}
      trigger={shortcut ? undefined : tr("Raccourci")}
      triggerVariant={shortcut ? "subtle" : "primary"}
      triggerSize={shortcut ? "icon-sm" : "md"}
      triggerIcon={shortcut ? <Pencil size={14} /> : <Plus size={16} />}
      triggerLabel={shortcut ? tr("Modifier le raccourci") : tr("Nouveau raccourci")}
      size="lg"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label={tr("Nom")} name="name" defaultValue={shortcut?.name} placeholder={tr("Jellyfin")} required />
        <TextField label="URL" name="url" type="url" defaultValue={shortcut?.url} placeholder="https://jellyfin.lan" required className="font-mono" />
        <TextField label={tr("Description")} name="description" defaultValue={shortcut?.description} placeholder={tr("Médiathèque")} className="sm:col-span-2" />
        <SelectField
          label={tr("Groupe")}
          name="group_id"
          defaultValue={shortcut?.group_id ?? ""}
          placeholder={tr("— Sans groupe —")}
          options={groups.map((g) => ({ value: g.id, label: g.name }))}
        />
        <SelectField
          label={tr("Hébergé sur")}
          name="asset_id"
          defaultValue={shortcut?.asset_id ?? ""}
          placeholder={tr("— Non lié —")}
          options={assets.map((a) => ({ value: a.id, label: a.display_name }))}
        />
      </div>
      <IconPicker
        defaultType={shortcut?.icon_type}
        defaultValue={shortcut?.icon_value}
        uploads={uploads}
        suggestion={shortcut?.name.toLowerCase()}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Switch name="new_tab" label={tr("Ouvrir dans un nouvel onglet")} defaultChecked={shortcut ? !!shortcut.new_tab : true} />
        <Switch
          name="status_check"
          label={tr("Vérifier la disponibilité")}
          hint={tr("Requête HEAD depuis le serveur chaque minute")}
          defaultChecked={shortcut ? !!shortcut.status_check : true}
        />
      </div>
    </FormDialog>
  );
}

function GroupDialog({ group }: { group?: ShortcutGroup }) {
  const tr = useT();
  return (
    <FormDialog
      title={group ? tr("Renommer le groupe") : tr("Nouveau groupe")}
      action={saveGroupAction.bind(null, group?.id ?? null)}
      trigger={undefined}
      triggerVariant={group ? "subtle" : "secondary"}
      triggerSize={group ? "icon-sm" : "icon"}
      triggerIcon={group ? <Pencil size={14} /> : <FolderPlus size={16} />}
      triggerLabel={group ? tr("Renommer le groupe") : tr("Nouveau groupe")}
      size="sm"
    >
      <TextField label={tr("Nom du groupe")} name="name" defaultValue={group?.name} placeholder={tr("Médias, Infrastructure, Domotique…")} required />
    </FormDialog>
  );
}

