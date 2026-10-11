import assert from "node:assert/strict";
import { test } from "node:test";
import { consumeChallenge, relyingParty, storeChallenge } from "./passkeys";

test("passkeys : HTTPS uniquement", () => {
  assert.deepEqual(relyingParty(new Headers({ origin: "https://lab.example.com" })), {
    origin: "https://lab.example.com",
    rpID: "lab.example.com",
  });
  assert.equal(relyingParty(new Headers({ origin: "http://192.168.1.10:3000" })), null);
  assert.equal(relyingParty(new Headers()), null);
});

test("passkeys : défi à usage unique, lié à l'utilisateur, expirant", () => {
  storeChallenge("a", null, 0);
  assert.equal(consumeChallenge("a", null, 1000), true);
  assert.equal(consumeChallenge("a", null, 1000), false); // rejeu

  storeChallenge("b", 1, 0);
  assert.equal(consumeChallenge("b", 2, 1000), false); // autre utilisateur

  storeChallenge("c", null, 0);
  assert.equal(consumeChallenge("c", null, 6 * 60_000), false); // expiré
});
