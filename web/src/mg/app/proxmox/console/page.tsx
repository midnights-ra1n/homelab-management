import { notFound } from "next/navigation";
import { Suspense, use } from "react";
import { ArrowLeft } from "lucide-react";
import { getIntegration } from "@/lib/data/integrations";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { VncConsole } from "@/features/proxmox/vnc-console";
import { getT } from "@/i18n/server";

type Props = PageProps<"/[lang]/proxmox/console">;

export default function ConsolePage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Skeleton className="h-[70vh] rounded-2xl" />}>
      <Console searchParams={searchParams} />
    </Suspense>
  );
}

function Console({ searchParams }: { searchParams: Props["searchParams"] }) {
  const tr = use(getT());
  const sp = use(searchParams);
  const pick = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const integrationId = Number(pick("i"));
  const vmid = Number(pick("vmid"));
  const type = pick("type");
  const node = pick("node");
  const integration = use(getIntegration(integrationId));
  if (!integration || integration.type !== "proxmox" || !node || !Number.isInteger(vmid) || (type !== "qemu" && type !== "lxc")) notFound();
  const name = pick("name") || `${type === "lxc" ? "CT" : "VM"} ${vmid}`;

  return (
    <>
      <PageHeader
        title={name}
        description={`${integration.name} · ${node} · ${type === "lxc" ? "CT" : "VM"} ${vmid}`}
        actions={
          <ButtonLink href="/proxmox" variant="secondary" icon={<ArrowLeft size={16} />}>
            {tr("Proxmox")}
          </ButtonLink>
        }
      />
      <VncConsole integrationId={integrationId} node={node} type={type} vmid={vmid} />
    </>
  );
}
