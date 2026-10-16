/* next/navigation for the SPA: the history API, shared with the monitoring router (../ui.tsx). */
import { useSyncExternalStore } from "react";
import { navigate } from "../../ui";
import { invalidate } from "../lib/resource";

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, () => location.search);
  return new URLSearchParams(search);
}

/** Replaces the URL without a new history entry (filters, sort). */
function replace(to: string) {
  history.replaceState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const router = {
  push: (to: string) => navigate(to),
  replace: (to: string, _opts?: { scroll?: boolean }) => replace(to),
  refresh: () => invalidate(),
  back: () => history.back(),
};

export function useRouter() {
  return router;
}

/** Thrown by pages when an item does not exist; caught by the page error boundary. */
export class NotFoundError extends Error {}

export function notFound(): never {
  throw new NotFoundError("Introuvable");
}

export function redirect(to: string): never {
  navigate(to);
  throw new NotFoundError("Redirection");
}
