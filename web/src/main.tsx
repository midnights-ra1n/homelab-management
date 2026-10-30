import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { api, type Preferences } from "./api";
import { Alert, Toaster, navigate, setAppName, setTheme, usePath, useTitle } from "./ui";
import { AppShell } from "./layout";
import { AuthPage } from "./pages/Auth";
import { OverviewPage } from "./pages/Overview";
import { HostsPage, HostDetailPage } from "./pages/Hosts";
import { MonitorsPage, MonitorDetailPage } from "./pages/Monitors";
import { SettingsPage } from "./pages/Settings";
import { UpdatesPage } from "./pages/Updates";
import { PublicStatusPage, StatusEditorPage } from "./pages/PublicStatus";
import { DisksPage } from "./pages/Disks";
import { ContainersPage } from "./pages/Containers";
import { ReportsPage } from "./pages/Reports";
import { IncidentsPage } from "./pages/Incidents";
import { EnergyPage } from "./pages/Energy";
import { BandwidthPage } from "./pages/Bandwidth";
import { LogsPage } from "./shared/system";
import { OAuthConsent } from "./shared/OAuthConsent";

const ManagementApp = lazy(() => import("./mg/App"));
const MapPage = lazy(() => import("./pages/Map"));
const SupervisionPage = lazy(() => import("./pages/Supervision")); // shares the Map chunk
const WallPage = lazy(() => import("./pages/Supervision").then((m) => ({ default: m.WallPage })));

interface AuthState {
  setup_required: boolean; authenticated: boolean; username: string; version: string; dev_mode: boolean;
  role: "monitoring" | "management"; monitoring_url: string;
}

function App() {
  const path = usePath();
  const [auth, setAuth] = useState<AuthState>();

  const seg = path.split("/").filter(Boolean);
  // Detail pages (/hosts/3, /monitors/7) set their own title from the item's name; the public page uses its own title.
  const PAGE_TITLES: Record<string, string> = {
    "": "Vue d'ensemble", hosts: "Hôtes", map: "Carte", monitors: "Sondes", incidents: "Incidents", updates: "Mises à jour", disks: "Disques",
    containers: "Conteneurs", reports: "Rapports", energy: "Énergie", bandwidth: "Bande passante", "status-page": "Page de statut", settings: "Paramètres", logs: "Journaux",
  };
  if (auth) setAppName(auth.role);
  // The management interface sets its own titles once signed in.
  useTitle((auth?.role === "management" && auth.authenticated) || path === "/status" || path === "/wall" || seg[1] ? undefined : auth && !auth.authenticated ? (auth.setup_required ? "Premier démarrage" : "Connexion") : PAGE_TITLES[seg[0] ?? ""] ?? "");

  const loadAuth = () => api.get<AuthState>("/api/auth/state").then(setAuth, () => setAuth(undefined));
  useEffect(() => { loadAuth(); }, []);
  // Preferences edited in the iOS / macOS app apply here too.
  useEffect(() => {
    if (!auth?.authenticated || auth.role === "management") return;
    api.get<Preferences>("/api/preferences").then((p) => {
      if ((p.theme === "auto" || p.theme === "light" || p.theme === "dark") && p.theme !== (document.documentElement.dataset.theme ?? "auto")) setTheme(p.theme);
      if (p.monitors_view === "cards" || p.monitors_view === "table") try { localStorage.setItem("hlm-view-monitors", p.monitors_view); } catch { /* private mode */ }
    }, () => { /* keep local choices */ });
  }, [auth?.authenticated, auth?.role]);
  useEffect(() => {
    const on = () => setAuth((a) => (a ? { ...a, authenticated: false } : a));
    window.addEventListener("hlm:unauthorized", on);
    return () => window.removeEventListener("hlm:unauthorized", on);
  }, []);

  if (path === "/status" && auth?.role !== "management") return <PublicStatusPage />;
  if (path === "/wall" && auth?.role !== "management") return <Suspense fallback={null}><WallPage /></Suspense>;
  if (!auth) return null;
  const devBanner = auth.dev_mode && (
    <Alert kind="warning" className="rounded-none border-x-0 border-t-0" title="Mode test : données simulées et compte admin / devmode-password. Ne jamais exposer cette instance." />
  );
  if (!auth.authenticated) return <>{devBanner}<AuthPage setup={auth.setup_required} onDone={loadAuth} role={auth.role} /></>;
  // MCP OAuth consent: reached from Claude, kept on the same URL through the login above.
  if (path === "/oauth/authorize") return <OAuthConsent />;
  if (auth.role === "management") {
    return (
      <Suspense fallback={null}>
        <ManagementApp session={{ username: auth.username, version: auth.version, monitoringUrl: auth.monitoring_url }} />
      </Suspense>
    );
  }

  let page;
  if (seg[0] === "hosts" && seg[1]) page = <HostDetailPage id={Number(seg[1])} />;
  else if (seg[0] === "hosts") page = <HostsPage />;
  else if (seg[0] === "supervision") page = <Suspense fallback={null}><SupervisionPage /></Suspense>;
  else if (seg[0] === "map") page = <Suspense fallback={null}><MapPage /></Suspense>;
  else if (seg[0] === "monitors" && seg[1]) page = <MonitorDetailPage id={Number(seg[1])} />;
  else if (seg[0] === "monitors") page = <MonitorsPage />;
  else if (seg[0] === "incidents") page = <IncidentsPage />;
  else if (seg[0] === "updates") page = <UpdatesPage />;
  else if (seg[0] === "disks") page = <DisksPage />;
  else if (seg[0] === "containers") page = <ContainersPage />;
  else if (seg[0] === "reports") page = <ReportsPage />;
  else if (seg[0] === "energy") page = <EnergyPage />;
  else if (seg[0] === "bandwidth") page = <BandwidthPage />;
  else if (seg[0] === "status-page") page = <StatusEditorPage />;
  else if (seg[0] === "settings") page = <SettingsPage version={auth.version} />;
  else if (seg[0] === "logs") page = <LogsPage entityHref={(e) => (e.entity_id && (e.entity_type === "host" || e.entity_type === "monitor") ? `/${e.entity_type}s/${e.entity_id}` : undefined)} />;
  else page = <OverviewPage />;

  const logout = () => api.post("/api/auth/logout").then(() => { navigate("/"); loadAuth(); });
  return (
    <>
      {devBanner}
      <AppShell username={auth.username} version={auth.dev_mode ? "dev" : auth.version} onLogout={logout}>{page}</AppShell>
    </>
  );
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><Toaster><App /></Toaster></StrictMode>,
);
