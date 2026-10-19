/* Consent page of the MCP OAuth flow (/oauth/authorize), shown by both interfaces once signed in:
   the user lets an assistant (Claude…) read this server through the MCP tools. */
import { useEffect, useState } from "react";
import { Bot, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { Alert, Button, Card, CardBody, CardHeader, Logo, Skeleton } from "../ui";

interface Info { client_name: string; redirect_host: string; dynamic: boolean; server: string; role: string }

export function OAuthConsent() {
  const [info, setInfo] = useState<Info>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"yes" | "no">();
  useEffect(() => { api.get<Info>(`/api/oauth/authorize${location.search}`).then(setInfo, (e) => setError(e.message)); }, []);

  const answer = async (approve: boolean) => {
    setBusy(approve ? "yes" : "no");
    try {
      const r = await api.post<{ redirect: string }>("/api/oauth/authorize", { query: location.search, approve });
      location.href = r.redirect;
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    }
  };

  return (
    <main className="mx-auto grid min-h-dvh max-w-lg content-center gap-6 px-4 py-10">
      <Logo />
      {error && <Alert kind="error" title="Autorisation impossible">{error}</Alert>}
      {!info && !error && <Skeleton className="h-56" />}
      {info && (
        <Card>
          <CardHeader overline="Serveur MCP" title={`Autoriser « ${info.client_name} » ?`} />
          <CardBody className="grid gap-4 text-sm text-body">
            <p className="flex items-start gap-2"><Bot size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span><strong className="text-h1">{info.client_name}</strong> demande à lire les données du {info.role === "management" ? "serveur de gestion" : "monitoring"} <strong className="text-h1">{info.server}</strong> avec les outils MCP.</span></p>
            <p className="flex items-start gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Accès en lecture seule. La réponse sera renvoyée à <span className="font-mono text-h1">{info.redirect_host}</span>. Vous pourrez révoquer l'accès dans Paramètres → Serveur MCP.</span></p>
            {info.redirect_host !== "claude.ai" && info.redirect_host !== "claude.com" && !info.redirect_host.startsWith("localhost") && !info.redirect_host.startsWith("127.0.0.1") && (
              <Alert kind="warning" title="Ce client ne renvoie pas vers Claude">N'autorisez que si vous avez configuré vous-même ce client.</Alert>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" loading={busy === "no"} disabled={!!busy} onClick={() => answer(false)}>Refuser</Button>
              <Button loading={busy === "yes"} disabled={!!busy} onClick={() => answer(true)}>Autoriser</Button>
            </div>
          </CardBody>
        </Card>
      )}
    </main>
  );
}
