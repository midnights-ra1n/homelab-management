import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { en } from "./en";
import { createT, translate } from "./translate";

test("traduction exacte, espaces conservés, repli sur le français", () => {
  assert.equal(translate("en", "Se connecter"), "Sign in");
  assert.equal(translate("en", " Se connecter "), " Sign in ");
  assert.equal(translate("fr", "Se connecter"), "Se connecter");
  assert.equal(translate("en", "Phrase inconnue"), "Phrase inconnue");
  assert.equal(translate("en", undefined), "");
});

test("paramètres et messages dynamiques du serveur", () => {
  const tr = createT("en");
  assert.equal(tr("{n} sonde(s) active(s)", { n: 3 }), "3 active probe(s)");
  assert.equal(createT("fr")("{n} sonde(s) active(s)", { n: 3 }), "3 sonde(s) active(s)");
  // message déjà formaté côté serveur (journal d'activité, erreurs zod)
  assert.equal(tr("Ajout de « pve-01 » à l'inventaire"), "Added “pve-01” to the inventory");
  assert.equal(tr("500 caractères maximum"), "500 characters maximum");
  // la valeur capturée est elle-même traduite si elle est connue
  assert.equal(tr("Le nom est requis"), "The name is required");
});

test("toutes les chaînes françaises passées à tr() ont une traduction", () => {
  const missing: string[] = [];
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk("src").filter((f) => f.endsWith(".tsx"))) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(/\btr\(\s*("(?:[^"\\]|\\.)*")/g)) {
      const key = (JSON.parse(m[1]) as string).trim();
      if (/[À-ÿœ]/.test(key) && !(key in en)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});
