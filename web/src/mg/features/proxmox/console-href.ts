/** Lien vers la console noVNC intégrée (page /proxmox/console). Partagé serveur / client. */
export function consoleHref(g: { integrationId: number; node: string; type: "qemu" | "lxc"; vmid: number; name: string }) {
  const p = new URLSearchParams({ i: String(g.integrationId), node: g.node, type: g.type, vmid: String(g.vmid), name: g.name });
  return `/proxmox/console?${p}`;
}

/** Page détaillée d'un nœud Proxmox. */
export function nodeHref(integrationId: number, node: string) {
  return `/proxmox/${integrationId}/${encodeURIComponent(node)}`;
}

/** Page détaillée d'une VM / d'un CT. */
export function guestHref(g: { integrationId: number; node: string; type: "qemu" | "lxc"; vmid: number }) {
  return `${nodeHref(g.integrationId, g.node)}/${g.type}/${g.vmid}`;
}

/** Ligne du tableau des invités à partir d'une ressource /cluster/resources. */
export function toGuestRow(
  s: { id: number; name: string; url: string },
  g: { node: string; type: string; vmid?: number; name?: string; status: string; cpu?: number; maxcpu?: number; mem?: number; maxmem?: number; disk?: number; maxdisk?: number; uptime?: number; tags?: string },
) {
  return {
    key: `${s.id}-${g.node}-${g.vmid}`,
    integrationId: s.id,
    integrationName: s.name,
    baseUrl: s.url,
    node: g.node,
    type: g.type as "qemu" | "lxc",
    vmid: g.vmid!,
    name: g.name ?? String(g.vmid),
    status: g.status,
    cpu: g.cpu ?? 0,
    maxcpu: g.maxcpu ?? 0,
    mem: g.mem ?? 0,
    maxmem: g.maxmem ?? 0,
    disk: g.disk ?? 0,
    maxdisk: g.maxdisk ?? 0,
    uptime: g.uptime ?? 0,
    tags: (g.tags ?? "").split(/[;,\s]+/).filter(Boolean),
  };
}
