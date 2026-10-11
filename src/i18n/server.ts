import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { lang } from "next/root-params";
import { createT } from "./translate";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./locales";

/** Langue de la page (segment racine [lang], connu au prérendu). */
export const getLocale = cache(async (): Promise<Locale> => {
  const l = await lang();
  return isLocale(l) ? l : DEFAULT_LOCALE;
});

export const getT = cache(async () => createT(await getLocale()));

/** Server Actions et Route Handlers : pas de root params, on lit le cookie. */
export async function getRequestT() {
  const l = (await cookies()).get(LOCALE_COOKIE)?.value;
  return createT(isLocale(l) ? l : DEFAULT_LOCALE);
}
