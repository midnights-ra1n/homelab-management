import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentForm } from "@/features/deployments/deployment-form";
import { deploymentFormOptions } from "../form-data";

export const metadata: Metadata = { title: "Nouveau déploiement" };

export default function NewDeploymentPage() {
  return (
    <>
      <PageHeader title="Planifier un déploiement" />
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
