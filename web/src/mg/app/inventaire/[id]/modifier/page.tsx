import { notFound } from "next/navigation";
import { Suspense, use } from "react";
import { getAsset } from "@/lib/data/assets";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetForm } from "@/features/inventory/asset-form";
import { assetFormOptions } from "../../form-data";

export default function EditAssetPage({ params }: PageProps<"/[lang]/inventaire/[id]/modifier">) {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
      <Edit params={params} />
    </Suspense>
  );
}

function Edit({ params }: { params: PageProps<"/[lang]/inventaire/[id]/modifier">["params"] }) {
  const asset = use(getAsset(Number((use(params)).id)));
  if (!asset) notFound();
  return (
    <>
      <PageHeader title={asset.display_name} description={asset.hostname || undefined} />
      <AssetForm asset={asset} {...assetFormOptions()} />
    </>
  );
}
