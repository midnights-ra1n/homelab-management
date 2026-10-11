import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentForm } from "@/features/deployments/deployment-form";
import { deploymentFormOptions } from "../form-data";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Nouveau déploiement") };
}

export default async function NewDeploymentPage() {
  const tr = await getT();
  return (
    <>
      <PageHeader title={tr("Planifier un déploiement")} />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Form />
      </Suspense>
    </>
  );
}

async function Form() {
  await requireUser();
  return <DeploymentForm {...deploymentFormOptions()} />;
}
