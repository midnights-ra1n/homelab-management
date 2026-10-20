/* One poll per URL, shared by every component that reads it (alert strip, banner, notifications
   menu): re-read every 30 s while the tab is visible, stopped when nobody listens any more. */
import { useEffect, useState } from "react";
import { api } from "../api";

const POLL_MS = 30_000;

type Poll = { subs: Set<(d: unknown) => void>; last?: unknown; tick: () => Promise<void>; stop: () => void };
const polls = new Map<string, Poll>();

function start(url: string): Poll {
  const p: Poll = {
    subs: new Set(),
    tick: () => document.hidden ? Promise.resolve() :
      api.get(url).then((d) => { p.last = d; p.subs.forEach((f) => f(d)); }, () => {}), // network down: keep the last state
    stop: () => { clearInterval(timer); document.removeEventListener("visibilitychange", p.tick); },
  };
  const timer = setInterval(p.tick, POLL_MS);
  document.addEventListener("visibilitychange", p.tick);
  polls.set(url, p);
  void p.tick();
  return p;
}

/** Last answer of `url` (undefined until the first one), shared with the other readers. */
export function usePolled<T>(url: string): T | undefined {
  const [data, setData] = useState(() => polls.get(url)?.last as T | undefined);
  useEffect(() => {
    const p = polls.get(url) ?? start(url);
    const f = (d: unknown) => setData(d as T);
    p.subs.add(f);
    if (p.last !== undefined) f(p.last);
    return () => {
      p.subs.delete(f);
      if (!p.subs.size) { p.stop(); polls.delete(url); }
    };
  }, [url]);
  return data;
}

/** Re-reads `url` now, after a write. */
export const refreshPolled = (url: string) => polls.get(url)?.tick() ?? Promise.resolve();
