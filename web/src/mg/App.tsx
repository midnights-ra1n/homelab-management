/* Management interface: the Next.js app routes (src/mg/app) served by a small history router. */
import { Component, lazy, Suspense, useEffect, useReducer, type ComponentType, type ReactNode } from "react";
import { SearchX } from "lucide-react";
import AppLayout from "./app/layout";
import { usePathname, useSearchParams, NotFoundError } from "./next/navigation";
import { onInvalidate, resolved, invalidate } from "./lib/resource";
import { SessionContext, type Session } from "./session";
import { Alert } from "./components/ui/alert";
import { Button, ButtonLink } from "./components/ui/button";
import { EmptyState } from "./components/ui/empty-state";
import { Skeleton } from "./components/ui/skeleton";
import { PwaRegister } from "./components/pwa-register";
import { LogsPage } from "../shared/system";

type Page = ComponentType<PageProps>;
const page = (load: () => Promise<{ default: Page }>) => lazy(load);

/** Path patterns (":name" = parameter), page and tab title, in matching order. */
const ROUTES: [string, Page, string][] = [
  ["/", page(() => import("./app/page")), "Tableau de bord"],
  ["/applications", page(() => import("./app/applications/page")), "Applications"],
  ["/inventaire", page(() => import("./app/inventaire/page")), "Inventaire"],
  ["/inventaire/nouveau", page(() => import("./app/inventaire/nouveau/page")), "Ajouter à l'inventaire"],
  ["/inventaire/:id", page(() => import("./app/inventaire/[id]/page")), "Inventaire"],
  ["/inventaire/:id/modifier", page(() => import("./app/inventaire/[id]/modifier/page")), "Modifier"],
  ["/reseau", page(() => import("./app/reseau/page")), "Réseau"],
  ["/carte", page(() => import("./app/carte/page")), "Carte"],
  ["/deploiements", page(() => import("./app/deploiements/page")), "Déploiements"],
  ["/deploiements/nouveau", page(() => import("./app/deploiements/nouveau/page")), "Nouveau déploiement"],
  ["/deploiements/:id", page(() => import("./app/deploiements/[id]/page")), "Déploiement"],
  ["/deploiements/:id/modifier", page(() => import("./app/deploiements/[id]/modifier/page")), "Modifier le déploiement"],
  ["/taches", page(() => import("./app/taches/page")), "Tâches"],
  ["/proxmox", page(() => import("./app/proxmox/page")), "Proxmox"],
  ["/proxmox/console", page(() => import("./app/proxmox/console/page")), "Console"],
  ["/proxmox/:id/:node", page(() => import("./app/proxmox/[id]/[node]/page")), "Nœud Proxmox"],
  ["/proxmox/:id/:node/:type/:vmid", page(() => import("./app/proxmox/[id]/[node]/[type]/[vmid]/page")), "Invité Proxmox"],
  ["/webmin", page(() => import("./app/webmin/page")), "Webmin"],
  ["/monitoring", page(() => import("./app/monitoring/page")), "Monitoring"],
  ["/journaux", Journal, "Journaux"],
  ["/parametres", page(() => import("./app/parametres/page")), "Paramètres"],
];

function match(path: string): { Page: Page; params: Record<string, string>; title: string } | null {
  const parts = path.split("/").filter(Boolean);
  for (const [pattern, Page, title] of ROUTES) {
    const want = pattern.split("/").filter(Boolean);
    if (want.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (want.every((w, i) => (w.startsWith(":") ? ((params[w.slice(1)] = decodeURIComponent(parts[i])), true) : w === parts[i]))) {
      return { Page, params, title };
    }
  }
  return null;
}

/** Journal entries link to the item they are about when it has a page. */
const ENTITY_PAGES: Record<string, string> = { asset: "/inventaire", deployment: "/deploiements" };
function Journal() {
  return <LogsPage entityHref={(e) => (e.entity_id && ENTITY_PAGES[e.entity_type] ? `${ENTITY_PAGES[e.entity_type]}/${e.entity_id}` : undefined)} />;
}

export default function ManagementApp({ session }: { session: Session }) {
  const path = usePathname();
  const search = useSearchParams();
  // A write invalidates the data cache: re-render so every use() fetches again.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onInvalidate(refresh), []);

  const route = match(path);
  useEffect(() => {
    document.title = route ? `${route.title} · Homelab Management` : "Homelab Management";
  }, [route?.title]);

  const searchParams = Object.fromEntries(search.entries());
  return (
    <SessionContext value={session}>
      <AppLayout>
        <PageErrors key={path}>
          <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
            {route ? <route.Page params={resolved(route.params)} searchParams={resolved(searchParams)} /> : <NotFound />}
          </Suspense>
        </PageErrors>
      </AppLayout>
      <PwaRegister />
    </SessionContext>
  );
}

function NotFound() {
  return (
    <EmptyState icon={<SearchX size={22} />} title="Page introuvable" action={<ButtonLink href="/">Tableau de bord</ButtonLink>}>
      Cet élément n'existe pas ou a été supprimé.
    </EmptyState>
  );
}

/** notFound() of a page, or a failed request, instead of a blank screen. */
class PageErrors extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (error instanceof NotFoundError) return <NotFound />;
    return (
      <Alert kind="error" title="Chargement impossible">
        <p>{error.message}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => {
            invalidate();
            this.setState({ error: undefined });
          }}
        >
          Réessayer
        </Button>
      </Alert>
    );
  }
}
