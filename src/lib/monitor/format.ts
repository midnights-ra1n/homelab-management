/** Formatage partagé serveur / client des données de disponibilité. */

export function uptimeTone(u: number | null) {
  if (u === null) return null;
  if (u >= 99.9) return "green" as const;
  if (u >= 99) return "yellow" as const;
  return "red" as const;
}

export function formatPct(u: number | null, digits = 2) {
  return u === null ? "—" : `${u >= 99.995 && u < 100 ? "99,99" : u.toFixed(u === 100 ? 0 : digits).replace(".", ",")} %`;
}

export function formatDuration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}
