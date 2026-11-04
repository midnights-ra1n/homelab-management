import { useId } from "react";

/** Logo : deux arches suivies du nom (point final Rose, selon la DA). */
export function Logo({ compact = false }: { compact?: boolean }) {
  const id = useId();
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 224 261" className="h-7 w-auto" aria-hidden="true">
        <defs>
          {/* Couleurs de la DA : une par application et par thème (--mm-logo-*). */}
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="224" y1="0" x2="0" y2="261">
            <stop offset="0" style={{ stopColor: "var(--mm-logo-1)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--mm-logo-2)" }} />
            <stop offset="1" style={{ stopColor: "var(--mm-logo-3)" }} />
          </linearGradient>
        </defs>
        <g fill={`url(#${id})`}>
          <path d="M0 0A110 110 0 0 1 110 110V261A110 110 0 0 1 0 151Z" />
          <path transform="translate(114 0)" d="M0 0A110 110 0 0 1 110 110V261A110 110 0 0 1 0 151Z" />
        </g>
      </svg>
      {!compact && (
        <span className="text-lg font-extrabold uppercase leading-none tracking-[-0.03em] text-h1">
          homelab<span className="text-pink">.</span>
        </span>
      )}
    </span>
  );
}
