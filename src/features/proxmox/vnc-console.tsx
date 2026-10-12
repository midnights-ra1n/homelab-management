"use client";

import { Keyboard, Maximize, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { vncSessionAction } from "@/actions/proxmox";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";

type Rfb = { disconnect(): void; sendCtrlAltDel(): void; focus(): void; scaleViewport: boolean; addEventListener(e: string, cb: (ev: CustomEvent) => void): void };
type State = "connecting" | "connected" | "disconnected";

/** Console noVNC d'un invité Proxmox, relayée par l'app (voir lib/integrations/vnc-relay). */
export function VncConsole({ integrationId, node, type, vmid }: { integrationId: number; node: string; type: "qemu" | "lxc"; vmid: number }) {
  const tr = useT();
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<Rfb | null>(null);
  const [state, setState] = useState<State>("connecting");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ default: RFB }, session] = await Promise.all([
        import("@novnc/novnc"),
        vncSessionAction(integrationId, node, type, vmid),
      ]);
      if (cancelled || !screen.current) return;
      if (!session.ok) {
        setError(session.message);
        setState("disconnected");
        return;
      }
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const r = new RFB(screen.current, `${proto}//${location.host}/api/vnc?token=${session.token}`, {
        credentials: { password: session.password },
        wsProtocols: ["binary"],
      }) as unknown as Rfb;
      r.scaleViewport = true;
      r.addEventListener("connect", () => {
        setState("connected");
        r.focus();
      });
      r.addEventListener("disconnect", (e) => {
        setState("disconnected");
        if (!e.detail?.clean) setError(tr("Connexion à la console perdue ou refusée par Proxmox."));
      });
      r.addEventListener("securityfailure", (e) => setError(String(e.detail?.reason ?? tr("Authentification VNC refusée"))));
      rfb.current = r;
    })().catch((e: Error) => {
      if (!cancelled) {
        setError(e.message);
        setState("disconnected");
      }
    });
    return () => {
      cancelled = true;
      rfb.current?.disconnect();
      rfb.current = null;
    };
  }, [integrationId, node, type, vmid, attempt, tr]);

  const tone = state === "connected" ? "green" : state === "connecting" ? "yellow" : "red";
  const label = state === "connected" ? tr("Connecté") : state === "connecting" ? tr("Connexion…") : tr("Déconnecté");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone={tone} dot>
          {label}
        </Badge>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Keyboard size={14} />} disabled={state !== "connected"} onClick={() => rfb.current?.sendCtrlAltDel()}>
            {tr("Ctrl+Alt+Suppr")}
          </Button>
          <Button variant="secondary" size="sm" icon={<Maximize size={14} />} onClick={() => void screen.current?.requestFullscreen()}>
            {tr("Plein écran")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCw size={14} />}
            disabled={state === "connecting"}
            onClick={() => {
              setError("");
              setState("connecting");
              setAttempt((n) => n + 1);
            }}
          >
            {tr("Reconnecter")}
          </Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div ref={screen} className="h-[70vh] min-h-80 w-full overflow-hidden rounded-2xl border border-line-subtle bg-black" />
    </div>
  );
}
