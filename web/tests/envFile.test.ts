// npm test: the variables editor must never alter what bash reads on the host.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { blankRow, envProblems, envTabular, mergeEnv, parseEnv, serializeEnv } from "../src/pages/envFile.ts";

test("typed values come back identical through bash and the parser", () => {
  const values = ["simple", "avec espace", "it's", 'q"uote', "$HOME", "a#b", "back\\slash", "", "postgres://u:p@h:5432/db?x=1"];
  const text = serializeEnv({ other: [], rows: values.map((v, i) => ({ ...blankRow(), k: `V${i}`, v })) });
  values.forEach((v, i) => assert.equal(parseEnv(text).rows[i].v, v));
  const env = JSON.parse(execFileSync("bash", ["-c", 'set -a; . /dev/stdin; node -e "console.log(JSON.stringify(process.env))"'], { input: text, encoding: "utf8" }));
  values.forEach((v, i) => assert.equal(env[`V${i}`], v));
});

test("an untouched file keeps its form and its comments", () => {
  const text = "# Managed by Ansible\nexport A=\"x $B\"\nC='z'";
  assert.equal(serializeEnv(parseEnv(text)), "# Managed by Ansible\nA=\"x $B\"\nC='z'");
});

test("values on several lines stay out of the blocks", () => {
  assert.equal(envTabular(parseEnv('A=1\nK="-----BEGIN\nabc\n-----END"\n')), false);
  assert.equal(envTabular(parseEnv('K="x\n#y"\n')), false);
  assert.equal(envTabular(parseEnv("# c\nA='it'\\''s'\nB=\"x\" # note\n")), true);
});

test("an import updates existing names and flags bad blocks", () => {
  const merged = mergeEnv(parseEnv("A=1\nB=2"), parseEnv("B=3\nC=4"));
  assert.equal(serializeEnv(merged), "A=1\nB=3\nC=4");
  const [a, b, c, d] = [{ ...blankRow(), k: "X" }, { ...blankRow(), k: "X" }, { ...blankRow(), k: "1Y" }, { ...blankRow(), v: "sans nom" }];
  assert.deepEqual([...envProblems([a, b, c, d, blankRow()]).keys()], [a.id, b.id, c.id, d.id]);
});
