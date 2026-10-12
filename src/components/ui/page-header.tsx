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
    <header className="rise mb-10 flex flex-col gap-6 sm:mb-14 md:flex-row md:items-end md:justify-between">
      {/* Pas de largeur max : la description tient sur une ligne tant que la place le permet. */}
      <div className="min-w-0 flex-1">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-h1 sm:text-3xl mint:sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 text-pretty text-[0.95rem] leading-relaxed text-body sm:text-base mint:sm:mt-4 mint:sm:text-lg">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/** Titre de sous-section dans une page. */
export function SectionTitle({ children, actions, id }: { children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4 sm:mb-5">
      <h2 id={id} className="text-sm font-medium text-meta mint:font-mono mint:text-xs mint:font-normal mint:uppercase mint:tracking-[0.18em]">
        {children}
      </h2>
      {actions}
    </div>
  );
}
