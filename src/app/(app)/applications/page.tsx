import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { listGroups, listShortcuts, listUploadedIcons } from "@/lib/data/shortcuts";
import { assetOptions } from "@/lib/data/assets";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonGrid } from "@/components/ui/skeleton";
import { AppsHome } from "@/features/apps/apps-home";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return (
    <>
      <PageHeader
        title={
          <>
            Tes services, <span className="text-accent-text">à un clic</span>
          </>
        }
        description="La page d'accueil du homelab : raccourcis groupés, icônes Dashboard Icons ou selfh.st, et état en direct de chaque service."
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
