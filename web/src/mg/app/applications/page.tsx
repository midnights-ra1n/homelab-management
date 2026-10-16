import { Suspense, use } from "react";
import { listGroups, listShortcuts, listUploadedIcons } from "@/lib/data/shortcuts";
import { assetOptions } from "@/lib/data/assets";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { AppsHome } from "@/features/apps/apps-home";
import { getT } from "@/i18n/server";

export default function ApplicationsPage() {
  const tr = use(getT());
  return (
    <>
      <PageHeader
        title={
          <>
            {tr("Tes services, ")}<span className="text-accent-text">{tr("à un clic")}</span>
          </>
        }
        description={tr("La page d'accueil du homelab : raccourcis groupés, icônes Dashboard Icons ou selfh.st, et état en direct de chaque service.")}
      />
      <Suspense fallback={<SkeletonGrid count={8} className="lg:grid-cols-4" />}>
        <Apps />
      </Suspense>
    </>
  );
}

function Apps() {
  return (
    <AppsHome
      shortcuts={use(listShortcuts())}
      groups={use(listGroups())}
      uploads={use(listUploadedIcons())}
      assets={use(assetOptions()).map((a) => ({ id: a.id, display_name: a.display_name }))}
    />
  );
}
