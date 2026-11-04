/** Resolves "3 hôte(s)" with the number before each (s) or (x): French keeps 0 and 1 singular. */
export function plural(text: string) {
  let count: number | null = null;
  return text.replace(/\d+|\((s|x)\)/g, (m, mark?: string) => {
    if (!mark) { count = Number(m); return m; }
    if (count === null) return m; // no number to agree with, like "http(s)"
    return count > 1 ? mark : "";
  });
}
