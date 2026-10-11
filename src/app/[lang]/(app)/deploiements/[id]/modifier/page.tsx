import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getDeployment } from "@/lib/data/deployments";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentForm } from "@/features/deployments/deployment-form";
import { deploymentFormOptions } from "../../form-data";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Modifier un déploiement") };
}

export default function EditDeploymentPage({ params }: PageProps<"/[lang]/deploiements/[id]/modifier">) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
      <Edit params={params} />
    </Suspense>
  );
}

async function Edit({ params }: { params: PageProps<"/[lang]/deploiements/[id]/modifier">["params"] }) {
  await requireUser();
  const deployment = getDeployment(Number((await params).id));
  if (!deployment) notFound();
  return (
    <>
      <PageHeader title={deployment.title} />
      <DeploymentForm deployment={deployment} {...deploymentFormOptions()} />
    </>
  );
}
