import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Base jetable : à fixer avant le premier import de la couche données.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hm-assets-"));
const { AssetError, ancestorsOf, bulkUpdateAssets, changeSummary, createAsset, getAsset, listAssets, updateAsset } = await import("./assets");
const { activityFor } = await import("./activity");
const { assetSchema } = await import("../validation");

const make = (display_name: string, parent_id: number | null = null, extra: Record<string, string> = {}) =>
  createAsset(assetSchema.parse({ kind: "vm", status: "online", display_name, parent_id: parent_id ?? "", ...extra }));

test("déplacements : pas de boucle hôte ↔ invité", () => {
  const host = make("host");
  const vm = make("vm", host);
  const ct = make("ct", vm);
  assert.deepEqual(ancestorsOf(ct).map((a) => a.display_name), ["host", "vm"]);
  assert.throws(() => bulkUpdateAssets([host], { op: "parent", parentId: ct }), AssetError);
  assert.throws(() => bulkUpdateAssets([vm], { op: "parent", parentId: vm }), AssetError);
  const input = assetSchema.parse({ kind: "vm", status: "online", display_name: "host", parent_id: String(ct) });
  assert.throws(() => updateAsset(host, input), AssetError);
  assert.equal(bulkUpdateAssets([ct], { op: "parent", parentId: null }), 1);
  assert.equal(getAsset(ct)?.parent_id, null);
});

test("actions groupées : tag sans doublon, état, suppression ; historique", () => {
  const a = make("a");
  const b = make("b", null, { tags: "web" });
  assert.equal(bulkUpdateAssets([a, b], { op: "tag", tag: "web" }), 1);
  assert.deepEqual(getAsset(a)?.tags, ["web"]);
  assert.equal(bulkUpdateAssets([a, b], { op: "status", status: "maintenance" }), 2);
  assert.equal(listAssets({ tag: "web", status: "maintenance" }).length, 2);
  assert.match(activityFor("asset", a)[0].summary, /: état$/);
  assert.equal(bulkUpdateAssets([a], { op: "delete" }), 1);
  assert.equal(getAsset(a), undefined);
});

test("recherche par MAC (tirets acceptés) et n° de série", () => {
  make("nas", null, { primary_ip: "10.9.0.5", primary_mac: "AA-BB-CC-DD-EE-01", serial_number: "SN-42" });
  assert.equal(listAssets({ q: "aa-bb-cc-dd-ee-01" })[0]?.display_name, "nas");
  assert.equal(listAssets({ q: "SN-42" })[0]?.display_name, "nas");
});

test("résumé des champs modifiés", () => {
  assert.equal(changeSummary({ status: "online", tags: "[]" }, { status: "offline", tags: "[]" }, "x"), "Modification de « x » : état");
  assert.equal(changeSummary({ gpu: "" }, { gpu: "rtx" }, "x"), "Modification de « x » : autres champs");
  assert.equal(changeSummary({ status: "online" }, { status: "online" }, "x"), "Modification de « x »");
});
