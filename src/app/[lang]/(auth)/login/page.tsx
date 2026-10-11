import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getCurrentUser, hasUsers } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm } from "../auth-forms";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const tr = await getT();
  return { title: tr("Connexion") };
}

export default async function LoginPage({ searchParams }: PageProps<"/[lang]/login">) {
  const tr = await getT();
  return (
    <div className="rounded-3xl border border-line-subtle bg-box p-7 sm:p-8">
      <h1 className="text-3xl font-bold tracking-tight text-h1">
        {tr("Bon retour ")}<span className="text-accent-text">{tr("au labo")}</span>
      </h1>
      <p className="mb-8 mt-3 text-sm leading-relaxed text-body">{tr("Connecte-toi pour gérer ton homelab.")}</p>
      <Suspense fallback={<Skeleton className="h-56" />}>
        <Gate searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Gate({ searchParams }: { searchParams: PageProps<"/[lang]/login">["searchParams"] }) {
  await connection();
  if (!hasUsers()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}
