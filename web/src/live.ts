/* Live updates: one EventSource on /api/events for the whole UI (see server/events.go).
   It opens with the first subscriber and closes with the last. */

export type Topic = "hosts" | "monitors" | "metrics" | "all";
type Listener = (topics: Topic[]) => void;

const listeners = new Set<Listener>();
let source: EventSource | undefined;
let connected = false;
let readyOnce = false;

const emit = (topics: Topic[]) => listeners.forEach((l) => l(topics));

function open() {
  source = new EventSource("/api/events");
  source.addEventListener("ready", () => {
    connected = true;
    // After a reconnection, events may have been missed: every live view reloads.
    if (readyOnce) emit(["all"]);
    readyOnce = true;
  });
  source.addEventListener("changed", (e) => {
    try { emit((JSON.parse((e as MessageEvent).data) as { topics: Topic[] }).topics); } catch { /* malformed event: ignored */ }
  });
  // EventSource reconnects by itself (retry: 5 s); meanwhile the views poll as before.
  source.onerror = () => { connected = false; };
}

export function subscribeLive(l: Listener): () => void {
  listeners.add(l);
  if (!source) open();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && source) {
      source.close();
      source = undefined;
      connected = readyOnce = false;
    }
  };
}

export const isLive = () => connected;
