import { notFound } from "next/navigation";
import { Suspense, use } from "react";
import { getDeployment } from "@/lib/data/deployments";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentForm } from "@/features/deployments/deployment-form";
import { deploymentFormOptions } from "../../form-data";

export default function EditDeploymentPage({ params }: PageProps<"/[lang]/deploiements/[id]/modifier">) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
      <Edit params={params} />
    </Suspense>
  );
}

function Edit({ params }: { params: PageProps<"/[lang]/deploiements/[id]/modifier">["params"] }) {
  const deployment = use(getDeployment(Number((use(params)).id)));
  if (!deployment) notFound();
  return (
    <>
      <PageHeader title={deployment.title} />
      <DeploymentForm deployment={deployment} {...deploymentFormOptions()} />
    </>
  );
}
