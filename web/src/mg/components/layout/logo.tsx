import { useId } from "react";

/** Logo : deux arches lavande suivies du nom (point final Rose, selon la DA). */
export function Logo({ compact = false }: { compact?: boolean }) {
  const id = useId();
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 224 261" className="h-7 w-auto" aria-hidden="true">
        <defs>
          {/* Lavande sur fond sombre ; passe au cran 700 en thème clair via les tokens d'accent. */}
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="224" y1="0" x2="0" y2="261">
            <stop offset="0" style={{ stopColor: "var(--mm-accent-hover)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--mm-accent)" }} />
            <stop offset="1" style={{ stopColor: "var(--mm-accent-active)" }} />
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
