export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** Les dates SQLite datetime('now') sont en UTC sans suffixe. */
export function toDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) || value.length <= 10 ? value : value.replace(" ", "T") + "Z");
}

export function formatDate(value: string | null | undefined) {
  return value ? dateFmt.format(toDate(value)) : "—";
}

export function formatDateTime(value: string | null | undefined) {
  return value ? dateTimeFmt.format(toDate(value)) : "—";
}

export function timeAgo(value: string) {
  const diff = (Date.now() - toDate(value).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  if (Math.abs(diff) < 60) return "à l'instant";
  if (Math.abs(diff) < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (Math.abs(diff) < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export function formatBytes(bytes: number | null | undefined, digits = 1) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To", "Po"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function formatGb(gb: number | null | undefined) {
  if (gb == null) return "—";
  return gb >= 1024 ? `${+(gb / 1024).toFixed(2)} To` : `${+gb.toFixed(1)} Go`;
}

export function formatUptime(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function pct(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

export function isOverdue(date: string | null | undefined) {
  if (!date) return false;
  return date < new Date().toISOString().slice(0, 10);
}

/** Nombre de jours entiers avant une date (négatif si passée). */
export function daysUntil(date: string) {
  return Math.floor((toDate(date).getTime() - Date.now()) / 86_400_000);
}
