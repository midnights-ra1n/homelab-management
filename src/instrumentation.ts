/** Démarre le moniteur de disponibilité et le relais de console noVNC avec le serveur Node.js. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installVncRelay } = await import("./lib/integrations/vnc-relay");
  installVncRelay();
  if (process.env.MONITOR_DISABLED === "true") return;
  const { startPoller } = await import("./lib/monitor/poller");
  startPoller();
}
