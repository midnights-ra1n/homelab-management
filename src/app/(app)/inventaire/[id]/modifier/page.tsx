import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { getAsset } from "@/lib/data/assets";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetForm } from "@/features/inventory/asset-form";
import { assetFormOptions } from "../../form-data";

export const metadata: Metadata = { title: "Modifier un élément" };

export default function EditAssetPage({ params }: PageProps<"/inventaire/[id]/modifier">) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
      <Edit params={params} />
    </Suspense>
  );
}

async function Edit({ params }: { params: PageProps<"/inventaire/[id]/modifier">["params"] }) {
  await requireUser();
  const asset = getAsset(Number((await params).id));
  if (!asset) notFound();
  return (
    <>
      <PageHeader title={asset.display_name} description={asset.hostname || undefined} />
      <AssetForm asset={asset} {...assetFormOptions()} />
    </>
  );
}
