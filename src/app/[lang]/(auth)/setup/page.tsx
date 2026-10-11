import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasUsers } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { SetupForm } from "../auth-forms";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Premier démarrage") };
}

export default async function SetupPage() {
  const tr = await getT();
  return (
    <div className="rounded-3xl border border-line-subtle bg-box p-7 sm:p-8">
      <p className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.18em] text-meta">
        <span className="relative flex h-3 w-3">
          <span className="ping absolute inset-0 rounded-full bg-accent" />
          <span className="relative h-3 w-3 rounded-full bg-accent" />
        </span>
        {tr("Premier démarrage")}</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight text-h1">
        {tr("Homelab ")}<span className="text-accent-text">{tr("Management")}</span>
      </h1>
      <p className="mb-8 mt-3 text-sm leading-relaxed text-body">
        {tr("Crée le compte administrateur. Les secrets d'intégration (jetons Proxmox, Beszel…) seront chiffrés en AES-256-GCM dans la base.")}</p>
      <Suspense fallback={<Skeleton className="h-72" />}>
        <Gate />
      </Suspense>
    </div>
  );
}

async function Gate() {
  await connection();
  if (hasUsers()) redirect("/login");
  return <SetupForm />;
}
