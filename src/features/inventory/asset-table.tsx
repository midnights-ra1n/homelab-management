"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronRight, Copy, ExternalLink, Pencil, SquareTerminal } from "lucide-react";
import { Fragment, useMemo, useState, useTransition, type ReactNode } from "react";
import { bulkAssetAction } from "@/actions/inventory";
import { Badge, StatusDot, Tag } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useToast } from "@/components/ui/toaster";
import { KindAvatar } from "@/components/kind-icon";
import { consoleHref } from "@/features/proxmox/console-href";
import { ASSET_KIND_META, ASSET_STATUSES, ASSET_STATUS_META, STATUS_SOURCE_LABEL } from "@/lib/constants";
import type { Asset, AssetOption } from "@/lib/data/assets";
import { cn, formatDateTime } from "@/lib/utils";
import { usePathname, useT } from "@/i18n/client";
import { parseSort, sortAssets, treeRows, type Row, type SortKey } from "./sort";
import { resourceSummary } from "./summary";

/** Copie avec repli : navigator.clipboard n'existe pas en HTTP simple (homelab sans TLS). */
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

export function AssetTable({ assets, hosts }: { assets: Asset[]; hosts: AssetOption[] }) {
  const tr = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const sort = parseSort(params.get("sort"));
  const tree = params.get("view") === "tree";
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const sorted = useMemo(() => sortAssets(assets, sort), [assets, sort]);
  const rows: Row[] = tree ? treeRows(sorted, collapsed) : sorted.map((asset) => ({ asset, depth: 0, hasChildren: false }));
  // La sélection ne garde que les éléments encore affichés (après filtre / suppression).
  const visibleSelected = assets.filter((a) => selected.has(a.id)).map((a) => a.id);
  const allSelected = visibleSelected.length === assets.length && assets.length > 0;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const toggleSort = (key: SortKey) =>
    setParam("sort", sort?.key !== key ? key : !sort.desc ? `-${key}` : null);
  const toggle = (set: Set<number>, id: number) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const head = (key: SortKey | null, label: string, className?: string) => (
    <th
      className={className}
      aria-sort={key && sort?.key === key ? (sort.desc ? "descending" : "ascending") : undefined}
      scope="col"
    >
      {key ? (
        <button type="button" className="mm-th-sort" onClick={() => toggleSort(key)}>
          {label}
          {sort?.key === key && (sort.desc ? <ArrowDown size={12} aria-hidden /> : <ArrowUp size={12} aria-hidden />)}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="mm-card">
      <div className="mm-card__head flex-wrap">
        {visibleSelected.length > 0 ? (
          <BulkBar ids={visibleSelected} hosts={hosts} onDone={() => setSelected(new Set())} />
        ) : (
          <>
            <p className="mm-help">{tr("{n} élément(s)", { n: assets.length })}</p>
            <div role="radiogroup" aria-label={tr("Affichage")} className="mm-segmented mm-segmented--sm">
              <button type="button" role="radio" aria-checked={!tree} className="mm-segmented__item" onClick={() => setParam("view", null)}>
                {tr("Liste")}
              </button>
              <button type="button" role="radio" aria-checked={tree} className="mm-segmented__item" onClick={() => setParam("view", "tree")}>
                {tr("Arbre")}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Moins de 640 px : liste de 64 px (charte), sans sélection. */}
      <ul className="mm-list border-t border-line sm:hidden">
        {rows.map(({ asset: a, depth }) => (
          <li key={a.id}>
            <Link href={`/inventaire/${a.id}`} className="mm-list__item items-center" style={{ paddingLeft: 16 + depth * 16 }}>
              <span className="flex min-w-0 items-center gap-3">
                <KindAvatar kind={a.kind} size="sm" />
                <span className="min-w-0">
                  <span className="mm-list__title block">{a.display_name}</span>
                  <span className="mm-list__meta block truncate font-mono">
                    {[a.primary_ip, a.hostname, tree ? null : a.parent_name].filter(Boolean).join(" · ") || tr(ASSET_KIND_META[a.kind].label)}
                  </span>
                </span>
              </span>
              <StatusDot tone={ASSET_STATUS_META[a.status].tone} />
            </Link>
          </li>
        ))}
      </ul>

      <div className="mm-table-wrap hidden border-t border-line sm:block">
        <table className="mm-table min-w-[60rem]">
          <thead>
            <tr>
              <th className="mm-col-check" scope="col">
                <input
                  type="checkbox"
                  aria-label={tr("Tout sélectionner")}
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = visibleSelected.length > 0 && !allSelected;
                  }}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(assets.map((a) => a.id)))}
                  className="size-4 accent-[var(--mm-accent)]"
                />
              </th>
              {head("name", tr("Nom"))}
              {head("status", tr("État"))}
              {head("ip", tr("Adresse"))}
              {!tree && head("host", tr("Hôte"))}
              {head("resources", tr("Ressources"), "mm-col-num")}
              {head(null, tr("Tags"))}
              <th scope="col">
                <span className="sr-only">{tr("Actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ asset: a, depth, hasChildren }) => {
              const status = ASSET_STATUS_META[a.status];
              const isSelected = selected.has(a.id);
              return (
                <tr key={a.id} aria-selected={isSelected} className="group">
                  <td className="mm-col-check">
                    <input
                      type="checkbox"
                      aria-label={tr("Sélectionner {name}", { name: a.display_name })}
                      checked={isSelected}
                      onChange={() => setSelected((s) => toggle(s, a.id))}
                      className="size-4 accent-[var(--mm-accent)]"
                    />
                  </td>
                  <td className="mm-col-strong max-w-[22rem]">
                    <div className="flex items-center gap-2" style={{ paddingLeft: depth * 24 }}>
                      {tree &&
                        (hasChildren ? (
                          <button
                            type="button"
                            onClick={() => setCollapsed((s) => toggle(s, a.id))}
                            aria-expanded={!collapsed.has(a.id)}
                            aria-label={collapsed.has(a.id) ? tr("Déplier {name}", { name: a.display_name }) : tr("Replier {name}", { name: a.display_name })}
                            className="mm-btn mm-btn--ghost mm-btn--icon mm-btn--sm size-6!"
                          >
                            <ChevronRight size={14} className={cn("transition-transform duration-[120ms]", !collapsed.has(a.id) && "rotate-90")} />
                          </button>
                        ) : (
                          <span className="w-6 shrink-0" />
                        ))}
                      <Link href={`/inventaire/${a.id}`} className="flex min-w-0 items-center gap-3 py-1.5 hover:text-accent-text">
                        <KindAvatar kind={a.kind} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate">{a.display_name}</span>
                          <span className="block truncate font-mono text-xs font-normal text-meta">
                            {a.hostname || tr(ASSET_KIND_META[a.kind].label)}
                          </span>
                        </span>
                      </Link>
                    </div>
                  </td>
                  <td>
                    <span
                      className="inline-flex items-center gap-2"
                      title={
                        a.status_source && a.status_checked_at
                          ? tr("via {source} · {when}", {
                              source: tr(STATUS_SOURCE_LABEL[a.status_source] ?? a.status_source),
                              when: formatDateTime(a.status_checked_at, tr.locale),
                            })
                          : undefined
                      }
                    >
                      <StatusDot tone={status.tone} />
                      {tr(status.label)}
                    </span>
                  </td>
                  <td>
                    {a.primary_ip ? <span className="block font-mono">{a.primary_ip}</span> : <span className="text-meta">—</span>}
                    {a.vlan_number && <span className="block font-mono text-xs text-meta">VLAN {a.vlan_number}</span>}
                  </td>
                  {!tree && (
                    <td>
                      {a.parent_id ? (
                        <Link href={`/inventaire/${a.parent_id}`} className="hover:text-accent-text">
                          {a.parent_name}
                        </Link>
                      ) : (
                        <span className="text-meta">—</span>
                      )}
                    </td>
                  )}
                  <td className="mm-col-num font-mono text-xs">{resourceSummary(a, tr) || <span className="text-meta">—</span>}</td>
                  <td>
                    <div className="flex max-w-[14rem] flex-wrap gap-1">
                      {a.tags.slice(0, 3).map((t) => (
                        <Link key={t} href={`/inventaire?tag=${encodeURIComponent(t)}`}>
                          <Tag>{t}</Tag>
                        </Link>
                      ))}
                      {a.tags.length > 3 && <Badge>+{a.tags.length - 3}</Badge>}
                    </div>
                  </td>
                  <td className="w-px">
                    <RowActions asset={a} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Actions rapides d'une ligne, visibles au survol ou au focus clavier. */
function RowActions({ asset: a }: { asset: Asset }) {
  const tr = useT();
  const toast = useToast();
  const items: ReactNode[] = [];
  if (a.primary_ip) {
    const ip = a.primary_ip;
    items.push(
      <Button
        key="ip"
        variant="ghost"
        size="icon-sm"
        title={tr("Copier l'IP")}
        aria-label={tr("Copier l'IP de {name}", { name: a.display_name })}
        icon={<Copy size={14} />}
        onClick={() => copy(ip).then(() => toast("success", tr("{ip} copiée.", { ip })))}
      />,
    );
  }
  if (a.management_url)
    items.push(
      <a
        key="admin"
        href={a.management_url}
        target="_blank"
        rel="noreferrer"
        title={tr("Administrer")}
        aria-label={tr("Administrer {name}", { name: a.display_name })}
        className="mm-btn mm-btn--ghost mm-btn--icon mm-btn--sm"
      >
        <ExternalLink size={14} />
      </a>,
    );
  if ((a.kind === "vm" || a.kind === "lxc") && a.proxmox_integration_id && a.proxmox_node && a.proxmox_vmid)
    items.push(
      <Link
        key="console"
        href={consoleHref({
          integrationId: a.proxmox_integration_id,
          node: a.proxmox_node,
          type: a.kind === "vm" ? "qemu" : "lxc",
          vmid: a.proxmox_vmid,
          name: a.display_name,
        })}
        title={tr("Console")}
        aria-label={tr("Console de {name}", { name: a.display_name })}
        className="mm-btn mm-btn--ghost mm-btn--icon mm-btn--sm"
      >
        <SquareTerminal size={14} />
      </Link>,
    );
  items.push(
    <Link
      key="edit"
      href={`/inventaire/${a.id}/modifier`}
      title={tr("Modifier")}
      aria-label={tr("Modifier {name}", { name: a.display_name })}
      className="mm-btn mm-btn--ghost mm-btn--icon mm-btn--sm"
    >
      <Pencil size={14} />
    </Link>,
  );
  return (
    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
      {items.map((i, n) => (
        <Fragment key={n}>{i}</Fragment>
      ))}
    </div>
  );
}

/** Barre d'actions groupées : état, tag, hôte, suppression. */
function BulkBar({ ids, hosts, onDone }: { ids: number[]; hosts: AssetOption[]; onDone: () => void }) {
  const tr = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [tag, setTag] = useState("");
  const run = (action: unknown) =>
    start(async () => {
      const r = await bulkAssetAction(ids, action);
      toast(r.ok ? "success" : "error", tr(r.message));
      if (r.ok) {
        setTag("");
        onDone();
      }
    });
  const control = "field h-8 rounded-full px-3 text-sm";

  return (
    <div className="flex w-full flex-wrap items-center gap-2" aria-busy={pending}>
      <p className="mr-auto text-sm font-medium text-h1" aria-live="polite">
        {tr("{n} sélectionné(s)", { n: ids.length })}
      </p>
      <select
        aria-label={tr("Changer l'état")}
        className={control}
        value=""
        disabled={pending}
        onChange={(e) => e.target.value && run({ op: "status", status: e.target.value })}
      >
        <option value="">{tr("Changer l'état…")}</option>
        {ASSET_STATUSES.map((s) => (
          <option key={s} value={s}>
            {tr(ASSET_STATUS_META[s].label)}
          </option>
        ))}
      </select>
      <select
        aria-label={tr("Déplacer vers un hôte")}
        className={control}
        value=""
        disabled={pending}
        onChange={(e) => e.target.value && run({ op: "parent", parentId: e.target.value === "none" ? null : Number(e.target.value) })}
      >
        <option value="">{tr("Déplacer vers…")}</option>
        <option value="none">{tr("— Aucun hôte —")}</option>
        {hosts
          .filter((h) => !ids.includes(h.id))
          .map((h) => (
            <option key={h.id} value={h.id}>
              {h.display_name}
            </option>
          ))}
      </select>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (tag.trim()) run({ op: "tag", tag: tag.trim() });
        }}
      >
        <input
          aria-label={tr("Tag à ajouter")}
          placeholder={tr("Ajouter un tag")}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className={cn(control, "w-36")}
          disabled={pending}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={pending || !tag.trim()}>
          {tr("Ajouter")}
        </Button>
      </form>
      <ConfirmButton
        action={() => bulkAssetAction(ids, { op: "delete" }).then((r) => (r.ok && onDone(), r))}
        variant="danger"
        size="sm"
        icon={null}
        message={tr("Supprimer {n} élément(s) ? Leurs adresses IP seront libérées et leurs invités détachés.", { n: ids.length })}
      >
        {tr("Supprimer")}
      </ConfirmButton>
      <Button variant="ghost" size="sm" onClick={onDone}>
        {tr("Annuler")}
      </Button>
    </div>
  );
}
