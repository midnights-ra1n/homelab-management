/** Lien vers la console noVNC intégrée (page /proxmox/console). Partagé serveur / client. */
export function consoleHref(g: { integrationId: number; node: string; type: "qemu" | "lxc"; vmid: number; name: string }) {
  const p = new URLSearchParams({ i: String(g.integrationId), node: g.node, type: g.type, vmid: String(g.vmid), name: g.name });
  return `/proxmox/console?${p}`;
}
