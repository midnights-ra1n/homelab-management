import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSort, sortAssets } from "./sort";
import type { Asset } from "@/lib/data/assets";

const a = (id: number, ip: string | null, name = `n${id}`) => ({ id, display_name: name, primary_ip: ip }) as Asset;

test("tri IP numérique, vides à la fin dans les deux sens", () => {
  const list = [a(1, "10.0.0.10"), a(2, null), a(3, "10.0.0.9")];
  assert.deepEqual(sortAssets(list, parseSort("ip")).map((x) => x.id), [3, 1, 2]);
  assert.deepEqual(sortAssets(list, parseSort("-ip")).map((x) => x.id), [1, 3, 2]);
});

test("tri inconnu = ordre d'origine", () => {
  const list = [a(2, null, "b"), a(1, null, "a")];
  assert.equal(parseSort("bogus"), null);
  assert.deepEqual(sortAssets(list, parseSort("bogus")).map((x) => x.id), [2, 1]);
  assert.deepEqual(sortAssets(list, parseSort("name")).map((x) => x.id), [1, 2]);
});

test("arbre : invités sous leur hôte, repli, hôte filtré → invité à la racine", async () => {
  const { treeRows } = await import("./sort");
  const n = (id: number, parent_id: number | null) => ({ id, parent_id, display_name: `n${id}` }) as Asset;
  const list = [n(1, null), n(2, 1), n(3, 2), n(4, 99)];
  assert.deepEqual(treeRows(list, new Set()).map((r) => [r.asset.id, r.depth, r.hasChildren]), [
    [1, 0, true],
    [2, 1, true],
    [3, 2, false],
    [4, 0, false],
  ]);
  assert.deepEqual(treeRows(list, new Set([1])).map((r) => r.asset.id), [1, 4]);
});
