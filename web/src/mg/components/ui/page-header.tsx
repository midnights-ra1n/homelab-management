import type { ReactNode } from "react";

/** En-tête de page de la charte : h1 30/38 · 600 (26/34 sous 640 px), directement en tête de page. */
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
    <header className="mm-page__head mb-6">
      {/* Pas de largeur max : la description tient sur une ligne tant que la place le permet. */}
      <div className="min-w-0 grow basis-96">
        <h1 className="mm-h1">{title}</h1>
        {description && <p className="mt-1 text-pretty text-meta">{description}</p>}
      </div>
      {actions && <div className="mm-btn-group min-w-0 items-center">{actions}</div>}
    </header>
  );
}

/** Titre de sous-section dans une page. */
export function SectionTitle({ children, actions, id }: { children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-4">
      <h2 id={id} className="mm-h2">
        {children}
      </h2>
      {actions}
    </div>
  );
}
