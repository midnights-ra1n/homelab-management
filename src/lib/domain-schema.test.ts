import assert from "node:assert/strict";
import { test } from "node:test";
import { domainSchema } from "./validation";

const parse = (fqdn: string) => domainSchema.safeParse({ fqdn, exposure: "lan" });

test("domainSchema : accepte sous-domaines et jokers, normalise", () => {
  assert.equal(parse("Jellyfin.Example.fr.").data?.fqdn, "jellyfin.example.fr");
  assert.ok(parse("*.lab.example.fr").success);
});

test("domainSchema : refuse les noms invalides", () => {
  for (const bad of ["", "localhost", "-a.example.fr", "a..fr", "http://a.fr", "a.fr/x"]) assert.equal(parse(bad).success, false, bad);
});
