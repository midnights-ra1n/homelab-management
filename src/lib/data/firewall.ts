import "server-only";
import { all, get, run } from "../db";
import type { FwProtocol, FwTarget } from "../constants";
import type { RuleInput } from "../validation";
import { logActivity } from "./activity";

export type FirewallRule = {
  id: number;
  position: number;
  name: string;
  enabled: number;
  action: "allow" | "deny";
  src_type: FwTarget;
  src_value: string;
  dst_type: FwTarget;
  dst_value: string;
  protocol: FwProtocol;
  ports: string;
  notes: string;
};

export function listRules(): FirewallRule[] {
  return all<FirewallRule>("SELECT * FROM firewall_rules ORDER BY position, id");
}

export function createRule(i: RuleInput) {
  const { lastId } = run(
    `INSERT INTO firewall_rules (position, name, enabled, action, src_type, src_value, dst_type, dst_value, protocol, ports, notes)
     VALUES ((SELECT COALESCE(MAX(position), -1) + 1 FROM firewall_rules), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [i.name, i.enabled ? 1 : 0, i.action, i.src_type, i.src_value, i.dst_type, i.dst_value, i.protocol, i.ports, i.notes],
  );
  logActivity("firewall", lastId, "create", `Règle de pare-feu « ${i.name || "#" + lastId} » ajoutée`);
}

export function updateRule(id: number, i: RuleInput) {
  run(
    `UPDATE firewall_rules SET name = ?, enabled = ?, action = ?, src_type = ?, src_value = ?, dst_type = ?, dst_value = ?,
       protocol = ?, ports = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    [i.name, i.enabled ? 1 : 0, i.action, i.src_type, i.src_value, i.dst_type, i.dst_value, i.protocol, i.ports, i.notes, id],
  );
}

export function toggleRule(id: number) {
  run("UPDATE firewall_rules SET enabled = 1 - enabled WHERE id = ?", [id]);
}

export function deleteRule(id: number) {
  const r = get<{ name: string }>("SELECT name FROM firewall_rules WHERE id = ?", [id]);
  run("DELETE FROM firewall_rules WHERE id = ?", [id]);
  if (r) logActivity("firewall", id, "delete", `Règle de pare-feu « ${r.name || "#" + id} » supprimée`);
}

/** Déplace une règle d'un cran (l'ordre compte : première règle correspondante appliquée). */
export function moveRule(id: number, direction: -1 | 1) {
  const rules = listRules();
  const i = rules.findIndex((r) => r.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= rules.length) return;
  [rules[i], rules[j]] = [rules[j], rules[i]];
  rules.forEach((r, pos) => run("UPDATE firewall_rules SET position = ? WHERE id = ?", [pos, r.id]));
}
