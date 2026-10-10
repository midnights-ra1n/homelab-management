"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import Link from "next/link";
import { ArrowUpRight, Globe, LayoutTemplate, Maximize, Trash2, X } from "lucide-react";
import { memo, useCallback, useMemo, useState, useTransition } from "react";
import { createLinkAction, deleteLinkAction, resetPositionsAction, savePositionsAction } from "@/actions/map";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KindIcon } from "@/components/kind-icon";
import { useToast } from "@/components/ui/toaster";
import {
  ASSET_KINDS,
  ASSET_KIND_META,
  ASSET_STATUS_META,
  LINK_KINDS,
  LINK_KIND_META,
  TONE_VAR,
  type AssetKind,
  type AssetStatus,
  type LinkKind,
  type Tone,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

export type MapAsset = {
  id: number;
  name: string;
  hostname: string;
  kind: AssetKind;
  status: AssetStatus;
  ip: string | null;
  parent_id: number | null;
  vlan: number | null;
  vlan_name: string | null;
  vlan_color: Tone | null;
  role: string;
};

export type MapLinkData = { id: number; source_id: number; target_id: number; kind: LinkKind; label: string };

export type MapTunnel = { id: number; name: string; type: string; typeLabel: string; status: string; a: number | null; b: number | null; bLabel: string };

type AssetNodeData = MapAsset & { dimmed: boolean };
type AssetNode = Node<AssetNodeData, "asset">;

const NODE_W = 210;
const NODE_H = 72;
const KIND_ORDER: Record<AssetKind, number> = { network: 0, physical: 1, other: 1, vm: 2, lxc: 2, docker: 3 };

/* ------------------------------------------------------------------------ *
 * Disposition automatique en arbre (hôte → invités → conteneurs)
 * ------------------------------------------------------------------------ */
function autoLayout(assets: MapAsset[]): Record<number, { x: number; y: number }> {
  const byParent = new Map<number | null, MapAsset[]>();
  const ids = new Set(assets.map((a) => a.id));
  for (const a of assets) {
    const p = a.parent_id && ids.has(a.parent_id) ? a.parent_id : null;
    byParent.set(p, [...(byParent.get(p) ?? []), a]);
  }
  const sort = (list: MapAsset[]) =>
    list.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));

  const width = new Map<number, number>();
  const measure = (a: MapAsset, seen: Set<number>): number => {
    if (seen.has(a.id)) return 1;
    seen.add(a.id);
    const kids = byParent.get(a.id) ?? [];
    const w = kids.length ? kids.reduce((n, k) => n + measure(k, seen), 0) : 1;
    width.set(a.id, w);
    return w;
  };

  const pos: Record<number, { x: number; y: number }> = {};
  const place = (a: MapAsset, x: number, depth: number, seen: Set<number>) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    const w = width.get(a.id) ?? 1;
    pos[a.id] = { x: x + ((w - 1) * (NODE_W + 30)) / 2, y: depth * 150 };
    let cx = x;
    for (const k of sort(byParent.get(a.id) ?? [])) {
      place(k, cx, depth + 1, seen);
      cx += (width.get(k.id) ?? 1) * (NODE_W + 30);
    }
  };

  const roots = sort(byParent.get(null) ?? []);
  const measured = new Set<number>();
  roots.forEach((r) => measure(r, measured));
  // Équipements réseau sur une première rangée, puis les arbres d'hôtes
  const network = roots.filter((r) => r.kind === "network");
  const others = roots.filter((r) => r.kind !== "network");
  const placed = new Set<number>();
  let x = 0;
  for (const r of others) {
    place(r, x, network.length ? 1 : 0, placed);
    x += (width.get(r.id) ?? 1) * (NODE_W + 30) + 60;
  }
  const total = Math.max(x - 60, NODE_W);
  network.forEach((n, i) => {
    const span = (width.get(n.id) ?? 1) * (NODE_W + 30);
    const start = total / 2 - (network.length * span) / 2;
    place(n, start + i * span, 0, placed);
  });
  // Cycles éventuels : on place ce qui reste en bas
  assets.filter((a) => !pos[a.id]).forEach((a, i) => (pos[a.id] = { x: i * (NODE_W + 30), y: 600 }));
  return pos;
}

/* ------------------------------------------------------------------------ */

const AssetNodeView = memo(function AssetNodeView({ data, selected }: NodeProps<AssetNode>) {
  const kindTone = TONE_VAR[ASSET_KIND_META[data.kind].tone];
  const vlanTone = data.vlan_color ? TONE_VAR[data.vlan_color] : "var(--mm-border)";
  const status = ASSET_STATUS_META[data.status];
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border bg-box px-3 py-2.5 transition-[opacity,box-shadow] duration-200",
        selected ? "border-accent shadow-[0_0_24px_4px_var(--mm-glow-accent-strong)]" : "border-line",
        data.dimmed && "opacity-25",
      )}
      style={{ width: NODE_W, minHeight: NODE_H, borderLeft: `4px solid ${vlanTone}` }}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2" />
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ color: kindTone, background: `color-mix(in srgb, ${kindTone} 14%, transparent)` }}
      >
        <KindIcon kind={data.kind} size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_VAR[status.tone] }} title={status.label} />
          <span className="truncate text-sm font-medium text-h1">{data.name}</span>
        </span>
        <span className="block truncate font-mono text-[0.68rem] text-meta">
          {data.ip ?? data.hostname ?? ASSET_KIND_META[data.kind].label}
          {data.vlan ? ` · v${data.vlan}` : ""}
        </span>
      </span>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2" />
    </div>
  );
});

type ExternalNode = Node<{ label: string; sub: string }, "external">;

const ExternalNodeView = memo(function ExternalNodeView({ data, selected }: NodeProps<ExternalNode>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-full border border-dashed bg-box px-4 py-2.5",
        selected ? "border-accent" : "border-[color-mix(in_srgb,var(--mm-purple)_60%,transparent)]",
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2" isConnectable={false} />
      <Globe size={15} className="text-purple" aria-hidden />
      <span>
        <span className="block text-sm font-medium text-h1">{data.label}</span>
        <span className="block font-mono text-[0.65rem] text-meta">{data.sub}</span>
      </span>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2" isConnectable={false} />
    </div>
  );
});

const nodeTypes = { asset: AssetNodeView, external: ExternalNodeView };


export function HomelabMap(props: {
  assets: MapAsset[];
  links: MapLinkData[];
  tunnels: MapTunnel[];
  vlans: { vlan_id: number; name: string; color: Tone }[];
  saved: Record<number, { x: number; y: number }>;
}) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

function Flow({
  assets,
  links,
  tunnels,
  vlans,
  saved,
}: {
  assets: MapAsset[];
  links: MapLinkData[];
  tunnels: MapTunnel[];
  vlans: { vlan_id: number; name: string; color: Tone }[];
  saved: Record<number, { x: number; y: number }>;
}) {
  const toast = useToast();
  const { fitView } = useReactFlow();
  const [, start] = useTransition();
  const [linkKind, setLinkKind] = useState<LinkKind>("ethernet");
  const [hiddenKinds, setHiddenKinds] = useState<Set<AssetKind>>(new Set());
  const [vlanFilter, setVlanFilter] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  const layout = useMemo(() => autoLayout(assets), [assets]);
  const visible = assets.filter((a) => !hiddenKinds.has(a.kind));
  const visibleIds = new Set(visible.map((a) => a.id));

  const maxX = Math.max(0, ...Object.values(layout).map((p) => p.x));
  const externals: ExternalNode[] = tunnels
    .filter((t) => !t.b && t.bLabel && (!t.a || visibleIds.has(t.a)))
    .map((t, i) => ({
      id: `ext-${t.id}`,
      type: "external",
      position: { x: maxX + NODE_W + 120, y: i * 110 },
      data: { label: t.bLabel, sub: `${t.typeLabel} · hors inventaire` },
    }));

  const assetNodes: AssetNode[] = visible.map((a) => ({
    id: String(a.id),
    type: "asset",
    position: saved[a.id] ?? layout[a.id] ?? { x: 0, y: 0 },
    data: { ...a, dimmed: vlanFilter !== null && a.vlan !== vlanFilter },
  }));
  const initialNodes: (AssetNode | ExternalNode)[] = [...assetNodes, ...externals];

  const initialEdges: Edge[] = [
    ...visible
      .filter((a) => a.parent_id && visibleIds.has(a.parent_id))
      .map((a) => ({
        id: `p-${a.id}`,
        source: String(a.parent_id),
        target: String(a.id),
        type: "smoothstep",
        selectable: false,
        style: { stroke: "var(--mm-border-strong)", strokeWidth: 1.5 },
      })),
    ...links
      .filter((l) => visibleIds.has(l.source_id) && visibleIds.has(l.target_id))
      .map((l) => {
        const meta = LINK_KIND_META[l.kind];
        return {
          id: `l-${l.id}`,
          source: String(l.source_id),
          target: String(l.target_id),
          label: l.label || meta.label,
          animated: l.kind === "vpn",
          style: {
            stroke: meta.tone === "muted" ? "var(--mm-accent)" : TONE_VAR[meta.tone],
            strokeWidth: 2,
            strokeDasharray: meta.dashed ? "6 4" : undefined,
          },
        } satisfies Edge;
      }),
    ...tunnels
      .filter((t) => t.a && visibleIds.has(t.a) && ((t.b && visibleIds.has(t.b)) || (!t.b && t.bLabel)))
      .map(
        (t) =>
          ({
            id: `v-${t.id}`,
            source: String(t.a),
            target: t.b ? String(t.b) : `ext-${t.id}`,
            label: `${t.typeLabel} · ${t.name}`,
            animated: t.status === "up",
            selectable: false,
            style: {
              stroke: t.status === "down" ? "var(--mm-red)" : "var(--mm-purple)",
              strokeWidth: 2.5,
              strokeDasharray: "8 5",
              opacity: t.status === "planned" ? 0.5 : 1,
            },
          }) satisfies Edge,
      ),
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState<AssetNode | ExternalNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  // Resynchronise quand les filtres / données changent (rendu, pas d'effet)
  const signature = `${assets.length}-${links.length}-${tunnels.length}-${[...hiddenKinds].join()}-${vlanFilter}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    const current = new Map(nodes.map((n) => [n.id, n.position]));
    setNodes(initialNodes.map((n) => ({ ...n, position: current.get(n.id) ?? n.position })));
    setEdges(initialEdges);
  }

  const onConnect = useCallback(
    (c: Connection) => {
      const source = Number(c.source);
      const target = Number(c.target);
      if (!source || !target || source === target) return;
      start(async () => {
        await createLinkAction(source, target, linkKind, "");
        toast("success", `Lien ${LINK_KIND_META[linkKind].label} ajouté`);
      });
    },
    [linkKind, toast],
  );

  const selectedAsset = assets.find((a) => a.id === selectedNode);
  const selectedLink = selectedEdge?.startsWith("l-") ? links.find((l) => `l-${l.id}` === selectedEdge) : undefined;

  return (
    <div className="relative h-[calc(100vh-15rem)] min-h-[32rem] overflow-hidden rounded-3xl border border-line-subtle bg-crust">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={(_, __, dragged) =>
          start(() =>
            savePositionsAction(
              dragged.filter((n) => n.type === "asset").map((n) => ({ id: Number(n.id), x: n.position.x, y: n.position.y })),
            ),
          )
        }
        onNodeClick={(_, n) => {
          if (n.type !== "asset") return;
          setSelectedNode(Number(n.id));
          setSelectedEdge(null);
        }}
        onEdgeClick={(_, e) => {
          setSelectedEdge(e.id);
          setSelectedNode(null);
        }}
        onPaneClick={() => {
          setSelectedNode(null);
          setSelectedEdge(null);
        }}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--mm-border)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor={(n) => (n.type === "asset" ? TONE_VAR[ASSET_KIND_META[(n.data as AssetNodeData).kind].tone] : TONE_VAR.purple)}
          className="hidden md:block"
        />

        {/* Barre d'outils */}
        <Panel position="top-left" className="!m-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-page/90 p-1 backdrop-blur">
            {ASSET_KINDS.filter((k) => assets.some((a) => a.kind === k)).map((k) => {
              const hidden = hiddenKinds.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={!hidden}
                  onClick={() => {
                    const next = new Set(hiddenKinds);
                    if (hidden) next.delete(k);
                    else next.add(k);
                    setHiddenKinds(next);
                  }}
                  title={`${hidden ? "Afficher" : "Masquer"} : ${ASSET_KIND_META[k].plural}`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs transition-colors",
                    hidden ? "text-meta line-through" : "text-h2 hover:bg-box",
                  )}
                >
                  <KindIcon kind={k} size={13} />
                  <span className="hidden sm:inline">{ASSET_KIND_META[k].plural}</span>
                </button>
              );
            })}
          </div>
          {vlans.length > 0 && (
            <select
              aria-label="Mettre en évidence un VLAN"
              value={vlanFilter ?? ""}
              onChange={(e) => setVlanFilter(e.target.value ? Number(e.target.value) : null)}
              className="field rounded-full bg-page/90 px-4 py-2 text-xs backdrop-blur"
            >
              <option value="">Tous les VLAN</option>
              {vlans.map((v) => (
                <option key={v.vlan_id} value={v.vlan_id}>
                  VLAN {v.vlan_id} · {v.name}
                </option>
              ))}
            </select>
          )}
        </Panel>

        <Panel position="top-right" className="!m-3 flex items-center gap-2">
          <label className="flex items-center gap-2 rounded-full border border-line bg-page/90 py-1 pl-3 pr-1 text-xs text-meta backdrop-blur">
            Nouveau lien
            <select
              value={linkKind}
              onChange={(e) => setLinkKind(e.target.value as LinkKind)}
              className="field rounded-full px-3 py-1 text-xs"
            >
              {LINK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LINK_KIND_META[k].label}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            size="icon"
            className="bg-page/90 backdrop-blur"
            title="Ajuster à l'écran"
            aria-label="Ajuster à l'écran"
            onClick={() => fitView({ padding: 0.2, maxZoom: 1, duration: 600 })}
            icon={<Maximize size={15} />}
          />
          <Button
            variant="secondary"
            size="icon"
            className="bg-page/90 backdrop-blur"
            title="Disposition automatique"
            aria-label="Disposition automatique"
            onClick={() =>
              start(async () => {
                await resetPositionsAction();
                setNodes((ns) => ns.map((n) => ({ ...n, position: layout[Number(n.id)] ?? n.position })));
                setTimeout(() => fitView({ padding: 0.2, maxZoom: 1, duration: 600 }), 50);
              })
            }
            icon={<LayoutTemplate size={15} />}
          />
        </Panel>

        {/* Panneau de détail */}
        {(selectedAsset || selectedLink) && (
          <Panel position="bottom-center" className="!mb-4 w-[min(26rem,calc(100%-2rem))]">
            <div className="rise rounded-2xl border border-line bg-elevated p-4 shadow-[var(--mm-shadow-popover)]">
              {selectedAsset && (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">
                      {ASSET_KIND_META[selectedAsset.kind].label}
                    </p>
                    <p className="mt-1 truncate font-semibold text-h1">{selectedAsset.name}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone={ASSET_STATUS_META[selectedAsset.status].tone} dot>
                        {ASSET_STATUS_META[selectedAsset.status].label}
                      </Badge>
                      {selectedAsset.ip && <Badge tone="muted">{selectedAsset.ip}</Badge>}
                      {selectedAsset.vlan && <Badge tone={selectedAsset.vlan_color ?? "accent"}>VLAN {selectedAsset.vlan}</Badge>}
                    </div>
                  </div>
                  <Link
                    href={`/inventaire/${selectedAsset.id}`}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-accent-text hover:bg-accent-soft"
                    aria-label="Ouvrir la fiche"
                  >
                    <ArrowUpRight size={17} />
                  </Link>
                  <button type="button" onClick={() => setSelectedNode(null)} className="p-2 text-meta hover:text-h1" aria-label="Fermer">
                    <X size={15} />
                  </button>
                </div>
              )}
              {selectedLink && (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[0.7rem] uppercase tracking-[0.14em] text-meta">Lien</p>
                    <p className="mt-1 truncate text-sm text-h1">
                      {assets.find((a) => a.id === selectedLink.source_id)?.name} →{" "}
                      {assets.find((a) => a.id === selectedLink.target_id)?.name}
                    </p>
                    <p className="text-xs text-meta">{LINK_KIND_META[selectedLink.kind].label}</p>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={13} />}
                    onClick={() =>
                      start(async () => {
                        await deleteLinkAction(selectedLink.id);
                        setSelectedEdge(null);
                      })
                    }
                  >
                    Supprimer
                  </Button>
                </div>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}
