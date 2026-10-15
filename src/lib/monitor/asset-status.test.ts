import assert from "node:assert/strict";
import { test } from "node:test";
import { ping, pingArgs } from "./asset-status";

test("arguments de ping selon la plateforme", () => {
  assert.deepEqual(pingArgs("10.0.0.5", 2000, "linux"), ["-n", "-c", "1", "-W", "2", "10.0.0.5"]);
  assert.deepEqual(pingArgs("10.0.0.5", 2000, "darwin"), ["-n", "-c", "1", "-W", "2000", "10.0.0.5"]);
  assert.deepEqual(pingArgs("10.0.0.5", 300, "linux").at(-2), "1");
});

test("ping : refuse ce qui n'est pas une IPv4, ne répond pas pour une IP non routée", async () => {
  assert.equal(await ping("-f"), false);
  assert.equal(await ping("192.0.2.1", 500), false); // TEST-NET-1
});
