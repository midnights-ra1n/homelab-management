import type { ReactNode } from "react";

/**
 * En-tête de page : titre bold tracking-tight, description en corps de texte.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="rise mb-8 flex flex-col gap-6 sm:mb-14 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-h1 sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 text-[0.95rem] leading-relaxed text-body sm:mt-4 sm:text-lg">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/** Titre de sous-section dans une page. */
export function SectionTitle({ children, actions, id }: { children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 sm:mb-5">
      <h2 id={id} className="font-mono text-xs uppercase tracking-[0.18em] text-meta">
        {children}
      </h2>
      {actions}
    </div>
  );
}
