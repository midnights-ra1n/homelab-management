import { Suspense, use } from "react";
import { ASSET_KINDS, type AssetKind } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetForm } from "@/features/inventory/asset-form";
import { assetFormOptions } from "../form-data";
import { getT } from "@/i18n/server";

export default function NewAssetPage({ searchParams }: PageProps<"/[lang]/inventaire/nouveau">) {
  const tr = use(getT());
  return (
    <>
      <PageHeader
        title={tr("Nouvel élément")}
        description={tr("Serveur physique, VM, conteneur LXC ou Docker, équipement réseau : renseigne son identité, son adressage et sa configuration.")}
      />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function Form({ searchParams }: { searchParams: PageProps<"/[lang]/inventaire/nouveau">["searchParams"] }) {
  const { kind, parent } = use(searchParams);
  const defaultKind = ASSET_KINDS.includes(kind as AssetKind) ? (kind as AssetKind) : "physical";
  return <AssetForm defaultKind={defaultKind} defaultParent={parent ? Number(parent) : undefined} {...assetFormOptions()} />;
}
