
import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { setTimeZoneAction } from "@/actions/settings";
import { inputClass } from "@/components/ui/form";
import { useToast } from "@/components/ui/toaster";
import { setClientTimeZone, TZ_COOKIE } from "@/lib/utils";
import { useT } from "@/i18n/client";

/** Sélecteur du fuseau horaire global (liste fournie par le serveur : même ICU qu'au rendu). */
export function TimeZoneSelect({ value, options }: { value: string; options: string[] }) {
  const tr = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="grid gap-2 text-sm font-medium text-h1">
      {tr("Fuseau horaire")}
      <select
        defaultValue={value}
        disabled={pending}
        className={`${inputClass} w-full font-mono sm:w-80`}
        onChange={(e) => {
          const tz = e.target.value;
          start(async () => {
            const r = await setTimeZoneAction(tz);
            toast(r.ok ? "success" : "error", tr(r.message));
            if (!r.ok) return;
            setClientTimeZone(tz);
            router.refresh();
          });
        }}
      >
        {options.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Aligne le navigateur sur le fuseau enregistré (sinon il afficherait l'heure de l'appareil). */
export function TimeZoneSync({ tz }: { tz: string }) {
  setClientTimeZone(tz);
  // Cookie relu au chargement suivant, avant tout rendu : pas d'heure de l'appareil au premier affichage.
  useEffect(() => {
    document.cookie = `${TZ_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
  }, [tz]);
  return null;
}
