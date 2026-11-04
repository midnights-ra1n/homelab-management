// npm test: counted labels read as real French.
import assert from "node:assert/strict";
import { test } from "node:test";
import { plural } from "../src/shared/plural.ts";

test("agrees with the closest number before it", () => {
  assert.equal(plural("1 hôte(s) · 3 paquet(s)"), "1 hôte · 3 paquets");
  assert.equal(plural("0 agent(s) connecté(s)"), "0 agent connecté");
  assert.equal(plural("4/5 étape(s) faite(s)"), "4/5 étapes faites");
  assert.equal(plural("2 sous-réseau(x)"), "2 sous-réseaux");
  assert.equal(plural("+ 1 autre(s) sonde(s) dans le hub"), "+ 1 autre sonde dans le hub");
});

test("leaves text without a number alone", () => {
  assert.equal(plural("URL http(s) invalide"), "URL http(s) invalide");
});
