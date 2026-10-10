/** Démarre le moniteur de disponibilité avec le serveur Node.js. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.MONITOR_DISABLED === "true") return;
  const { startPoller } = await import("./lib/monitor/poller");
  startPoller();
}
