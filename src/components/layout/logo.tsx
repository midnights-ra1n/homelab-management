/** Logo : deux barres obliques (menthe atténuée + accent) suivies du nom. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="248 128 528 768" className="h-7 w-auto" aria-hidden="true">
        <path d="M504 128L312 896H248L440 128H504Z" style={{ fill: "var(--mm-accent-muted)" }} />
        <path d="M776 128L584 896H360L552 128H776Z" style={{ fill: "var(--mm-accent)" }} />
      </svg>
      {!compact && (
        <span className="text-lg font-bold leading-none tracking-tight text-h1">
          homelab<span className="text-accent-text">.</span>
        </span>
      )}
    </span>
  );
}
