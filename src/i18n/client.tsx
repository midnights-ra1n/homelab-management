"use client";

import { usePathname as useNextPathname } from "next/navigation";
import { createContext, use, type ReactNode } from "react";
import { createT } from "./translate";
import { DEFAULT_LOCALE, type Locale } from "./locales";

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useT() {
  return createT(use(LocaleContext));
}

/** Pour les composants partagés serveur / client : <Tr>Texte</Tr>. */
export function Tr({ children }: { children: string }) {
  return useT()(children);
}

/** Chemin visible dans le navigateur : sans le segment [lang] ajouté par la réécriture du proxy. */
export function usePathname() {
  return useNextPathname().replace(/^\/(?:fr|en)(?=\/|$)/, "") || "/";
}
