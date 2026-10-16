import { Suspense, use } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentForm } from "@/features/deployments/deployment-form";
import { deploymentFormOptions } from "../form-data";
import { getT } from "@/i18n/server";

export default function NewDeploymentPage() {
  const tr = use(getT());
  return (
    <>
      <PageHeader title={tr("Planifier un déploiement")} />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Form />
      </Suspense>
    </>
  );
}

function Form() {
  return <DeploymentForm {...deploymentFormOptions()} />;
}
