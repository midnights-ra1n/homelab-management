import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { ASSET_KINDS, type AssetKind } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetForm } from "@/features/inventory/asset-form";
import { assetFormOptions } from "../form-data";

export const metadata: Metadata = { title: "Nouvel élément" };

export default function NewAssetPage({ searchParams }: PageProps<"/inventaire/nouveau">) {
  return (
    <>
      <PageHeader
        title="Nouvel élément"
        description="Serveur physique, VM, conteneur LXC ou Docker, équipement réseau : renseigne son identité, son adressage et sa configuration."
      />
      <Suspense fallback={<Skeleton className="h-[40rem] rounded-2xl" />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Form({ searchParams }: { searchParams: PageProps<"/inventaire/nouveau">["searchParams"] }) {
  await requireUser();
  const { kind, parent } = await searchParams;
  const defaultKind = ASSET_KINDS.includes(kind as AssetKind) ? (kind as AssetKind) : "physical";
  return <AssetForm defaultKind={defaultKind} defaultParent={parent ? Number(parent) : undefined} {...assetFormOptions()} />;
}
