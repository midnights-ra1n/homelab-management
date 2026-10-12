import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { detect, hostAlive } from "./asset-status";

const base = { id: 1, kind: "vm", display_name: "Web", hostname: "web.lan", proxmox_integration_id: null, proxmox_vmid: null, management_url: "", ip: "10.0.0.5" };
const empty = () => ({ guests: new Map(), pveOk: new Set<number>(), nodes: new Map(), beszel: new Map(), containers: new Map() });

test("Proxmox prime sur Beszel pour un invité lié", () => {
  const src = empty();
  src.pveOk.add(2);
  src.guests.set("2:101", false);
  src.beszel.set("web.lan", true);
  assert.deepEqual(detect({ ...base, proxmox_integration_id: 2, proxmox_vmid: 101 }, src), { online: false, source: "proxmox" });
});

test("Proxmox injoignable : repli sur Beszel (par IP)", () => {
  const src = empty();
  src.guests.set("2:101", true); // pveOk vide → ignoré
  src.beszel.set("10.0.0.5", true);
  assert.deepEqual(detect({ ...base, proxmox_integration_id: 2, proxmox_vmid: 101 }, src), { online: true, source: "beszel" });
});

test("serveur physique = nœud Proxmox (nom court)", () => {
  const src = empty();
  src.nodes.set("pve1", true);
  assert.deepEqual(detect({ ...base, kind: "physical", hostname: "PVE1.home.lan" }, src), { online: true, source: "proxmox" });
});

test("Docker : Maintenant uniquement, jamais de sonde", () => {
  const src = empty();
  src.containers.set("web", false);
  assert.deepEqual(detect({ ...base, kind: "docker", hostname: "", display_name: "web" }, src), { online: false, source: "maintenant" });
  assert.equal(detect({ ...base, kind: "docker", display_name: "x", hostname: "" }, empty()), null);
});

test("sonde TCP : port refusé = hôte vivant", async () => {
  const server = net.createServer().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  assert.equal(await hostAlive("127.0.0.1", 500), true); // 22/80… refusés en local → RST
  server.close();
  assert.equal(await hostAlive("192.0.2.1", 300), false); // TEST-NET-1, non routé
});
