import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { hlmData } from "./hlm";

test("Homelab Monitoring : jeton Bearer, sondes facultatives (403 toléré)", async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(`${req.url} ${req.headers.authorization}`);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/hosts") return res.end(JSON.stringify([{ id: 1, name: "pve-01", status: "operational" }]));
    res.statusCode = 403;
    res.end(JSON.stringify({ error: "Ce jeton n'a pas le scope monitors:read" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const i = { id: 1, type: "hlm", name: "hlm", url, enabled: 1, config: { token_secret: "hlm_x" }, created_at: "", updated_at: "" } as const;
  try {
    const data = await hlmData({ ...i, config: { ...i.config } });
    assert.equal(data.hosts[0].name, "pve-01");
    assert.deepEqual(data.monitors, []);
    assert.ok(seen.every((s) => s.endsWith("Bearer hlm_x")));
    await assert.rejects(hlmData({ ...i, config: {} }), /Jeton/);
  } finally {
    server.close();
  }
});
