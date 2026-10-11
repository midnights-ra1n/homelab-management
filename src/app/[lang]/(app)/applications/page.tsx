import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { listGroups, listShortcuts, listUploadedIcons } from "@/lib/data/shortcuts";
import { assetOptions } from "@/lib/data/assets";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { AppsHome } from "@/features/apps/apps-home";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Applications") };
}

export default async function ApplicationsPage() {
  const tr = await getT();
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

async function Apps() {
  await requireUser();
  return (
    <AppsHome
      shortcuts={listShortcuts()}
      groups={listGroups()}
      uploads={listUploadedIcons()}
      assets={assetOptions().map((a) => ({ id: a.id, display_name: a.display_name }))}
    />
  );
}
