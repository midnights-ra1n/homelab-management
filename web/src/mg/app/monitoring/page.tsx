import { Suspense, use } from "react";
import { ExternalLink, Settings } from "lucide-react";
import { listIntegrations } from "@/lib/data/integrations";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader, SectionTitle } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { HlmOverview, StatusHero, UpdatesSummary } from "@/features/monitoring/overview";
import { useSession } from "@/session";
import { getT } from "@/i18n/server";

export default function MonitoringPage() {
  const tr = use(getT());
  const { monitoringUrl } = useSession();
  return (
    <>
      <PageHeader
        title={tr("Supervision centralisée")}
        description={tr("Résumé de Homelab Monitoring : hôtes équipés de l'agent, sondes et mises à jour. Le détail reste dans le tableau de bord du monitoring.")}
        actions={
          <>
            {monitoringUrl && (
              <ButtonLink href={monitoringUrl} target="_blank" rel="noopener" variant="secondary" icon={<ExternalLink size={16} />}>
                {tr("Ouvrir le monitoring")}
              </ButtonLink>
            )}
            <ButtonLink href="/parametres#integrations" variant="secondary" icon={<Settings size={16} />}>
              {tr("Intégrations")}
            </ButtonLink>
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        <Sections />
      </Suspense>
    </>
  );
}

function Sections() {
  const tr = use(getT());
  const configured = use(listIntegrations("hlm", true)).length > 0;
  return (
    <div className="grid grid-cols-1 gap-12 xl:gap-16">
      <Suspense fallback={<Skeleton className="h-28 rounded-xl" />}>
        <StatusHero />
      </Suspense>
      {!configured && (
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-dashed border-line px-5 py-5 sm:flex-row sm:items-center sm:px-6">
          <p className="text-sm text-body">
            {tr("Connecte ")}
            <span className="text-h1">Homelab Monitoring</span>{" "}
            {tr("(URL + jeton d'API) pour suivre les hôtes, les sondes, les certificats et les mises à jour, et relier les agents à l'inventaire.")}
          </p>
          <ButtonLink href="/parametres#integrations" variant="secondary" size="sm" icon={<Settings size={14} />}>
            {tr("Intégrations")}
          </ButtonLink>
        </div>
      )}
      {configured && (
        <>
          <Suspense fallback={<SectionSkeleton title="Homelab Monitoring" />}>
            <HlmOverview />
          </Suspense>
          <Suspense fallback={<SectionSkeleton title={tr("Mises à jour")} />}>
            <UpdatesSummary />
          </Suspense>
        </>
      )}
    </div>
  );
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section aria-busy="true">
      <SectionTitle>{title}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    </section>
  );
}
