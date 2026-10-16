import { use } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import type { Issue } from "@/lib/net/engine";
import { TONE_VAR } from "@/lib/constants";
import { getT } from "@/i18n/server";

const META = {
  error: { label: "Erreur", glyph: "✕", tone: TONE_VAR.red },
  warning: { label: "Attention", glyph: "!", tone: TONE_VAR.yellow },
  info: { label: "Info", glyph: "i", tone: TONE_VAR.blue },
} as const;

/** Liste des problèmes détectés dans l'adressage, les VPN et le pare-feu. */
export function Diagnostics({ issues }: { issues: Issue[] }) {
  const tr = use(getT());
  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-line-subtle bg-box px-6 py-14 text-center">
        <CheckCircle2 size={28} className="text-green" />
        <p className="mt-3 font-semibold text-h1">{tr("Aucun problème détecté")}</p>
        <p className="mt-1 text-sm text-meta">
          {tr("Pas de chevauchement de sous-réseaux, de doublon d'adresse ou de MAC, d'IP fixe dans une plage DHCP ni de règle orpheline.")}</p>
      </div>
    );
  }
  const count = (l: Issue["level"]) => issues.filter((i) => i.level === l).length;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-body">
        <span className="text-red">{count("error")} {tr("erreur(s)")}</span> · <span className="text-yellow">{count("warning")} {tr("avertissement(s)")}</span> ·{" "}
        <span className="text-blue">{count("info")} {tr("info(s)")}</span>
      </p>
      <ul className="grid gap-2">
        {issues.map((i, idx) => {
          const m = META[i.level];
          const body = (
            <>
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold"
                style={{ background: m.tone, color: "var(--mm-surface)" }}
              >
                {m.glyph}
              </span>
              <span className="min-w-0 flex-1 text-sm text-h2">
                <span className="sr-only">{m.label} : </span>
                {tr(i.message)}
              </span>
            </>
          );
          return (
            <li key={idx}>
              {i.href ? (
                <Link href={i.href} className="flex items-start gap-3 rounded-2xl border border-line-subtle bg-box px-4 py-3 transition-colors hover:border-line-accent">
                  {body}
                </Link>
              ) : (
                <div className="flex items-start gap-3 rounded-2xl border border-line-subtle bg-box px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
