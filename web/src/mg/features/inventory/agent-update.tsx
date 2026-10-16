import { use, useState } from "react";
import { RefreshCw } from "lucide-react";
import { updateAgentsAction } from "@/actions/inventory";
import { agentsState, type AgentState } from "@/lib/data/assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

const busyAction = (a: AgentState) =>
  a.action?.action === "update_agent" && (a.action.state === "pending" || a.action.state === "running") && Date.now() / 1000 - a.action.at < 7200;

function useRun() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (ids: number[]) => {
    setBusy(true);
    const r = await updateAgentsAction(ids);
    setBusy(false);
    toast(r.ok ? "success" : "error", r.message);
  };
  return { busy, run };
}

/** Inventory list: one button for every outdated agent (shown only when there is one). */
export function UpdateAllAgentsButton() {
  const { agents } = use(agentsState());
  const { busy, run } = useRun();
  const outdated = agents.filter((a) => a.outdated && a.connected && !busyAction(a));
  if (!outdated.length) return null;
  return (
    <Button
      variant="secondary"
      icon={<RefreshCw size={15} />}
      disabled={busy}
      aria-busy={busy}
      title={outdated.map((a) => `${a.name} : ${a.version} → ${a.latest}`).join("\n")}
      onClick={() => run([])}
    >
      Mettre à jour {outdated.length} agent{outdated.length > 1 ? "s" : ""}
    </Button>
  );
}

/** Asset page: version of the item's agent and its update button. */
export function AgentVersion({ assetId }: { assetId: number }) {
  const { agents } = use(agentsState());
  const { busy, run } = useRun();
  const a = agents.find((x) => x.asset_id === assetId);
  if (!a) return null;
  const inProgress = busyAction(a);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line-subtle pt-3 text-sm">
      <span className="text-meta">Agent</span>
      <span className="font-mono text-h1">{a.version || "?"}</span>
      {a.install === "deb" && <Badge tone="muted">.deb</Badge>}
      {inProgress ? (
        <Badge tone="blue">Mise à jour en cours</Badge>
      ) : a.outdated ? (
        <Badge tone="yellow">{a.latest} disponible</Badge>
      ) : a.latest ? (
        <Badge tone="green">À jour</Badge>
      ) : null}
      {a.action?.action === "update_agent" && a.action.state === "failed" && <span className="text-xs text-red">{a.action.message}</span>}
      <Button
        size="sm"
        variant={a.outdated ? "primary" : "secondary"}
        className="ml-auto"
        icon={<RefreshCw size={13} />}
        disabled={busy || inProgress || !a.connected}
        title={a.connected ? undefined : "L'agent n'est pas connecté"}
        onClick={() => run([assetId])}
      >
        Mettre à jour l'agent
      </Button>
    </div>
  );
}
