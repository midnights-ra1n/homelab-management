import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "../../../shared/icons";
import { useT } from "@/i18n/client";

const DELAYS: [string, string][] = [
  ["Ici → Nextcloud", "≈ 1 s, dès l'enregistrement"],
  ["iPhone, iPad ou Mac → Nextcloud", "aussitôt : l'appareil envoie ses modifications tout de suite"],
  ["Nextcloud → ici", "10 s au plus"],
  ["Nextcloud → Mac", "1 min, avec le réglage ci-dessous"],
  ["Nextcloud → iPhone et iPad", "à l'ouverture de Rappels ; sinon toutes les 15 min au mieux"],
];

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="grid gap-1.5">
      <h3 className="text-sm font-medium text-h1">{title}</h3>
      <div className="grid gap-1.5 text-sm text-body">{children}</div>
    </li>
  );
}

const Path = ({ children }: { children: ReactNode }) => <span className="font-mono text-xs text-h2">{children}</span>;

/** Guide repliable : mettre en place Nextcloud et Rappels, et ce qu'il faut attendre des délais. */
export function TaskSyncGuide({ open }: { open: boolean }) {
  const tr = useT();
  return (
    <details className="mm-card group" open={open}>
      <summary className="mm-card__head cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="mm-card__title">{tr("Synchroniser avec Nextcloud et Rappels (iPhone, iPad, Mac)")}</span>
        <ChevronDown size={16} className="ml-auto shrink-0 text-meta transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mm-card__body grid gap-8 lg:grid-cols-2">
        <ol className="grid list-decimal content-start gap-5 pl-5 marker:font-mono marker:text-meta">
          <Step title={tr("Nextcloud : les listes")}>
            <p>{tr("Dans Nextcloud Tâches, crée une liste par usage (Perso, Pro…).")}</p>
            <p>
              {tr("Mot de passe d'application :")} <Path>{tr("Paramètres personnels → Sécurité → Créer un mot de passe d'application")}</Path>.
            </p>
            <p>
              {tr("Lien de chaque liste :")} <Path>{tr("menu ⋯ de la liste → Copier le lien privé")}</Path>.
            </p>
          </Step>
          <Step title={tr("Ici : une intégration par liste")}>
            <p>
              <Link href="/parametres#integrations" className="text-accent-text hover:underline">
                {tr("Paramètres → Intégrations")}
              </Link>{" "}
              {tr("→ Nextcloud, avec le lien de la liste, ton identifiant et le mot de passe d'application. Recommence pour chaque liste.")}
            </p>
            <p>{tr("Dès qu'il y a deux listes, le formulaire d'une tâche propose « Liste Nextcloud ». Sans choix, une tâche va dans la première liste active.")}</p>
          </Step>
          <Step title={tr("iPhone et iPad")}>
            <p>
              <Path>{tr("Réglages → Rappels → Comptes → Ajouter un compte → Autre → Compte CalDAV")}</Path>
            </p>
            <p>
              {tr("Serveur : l'adresse de ton Nextcloud (cloud.exemple.fr ; si elle n'est pas reconnue : https://cloud.exemple.fr/remote.php/dav). Identifiant et mot de passe d'application comme ci-dessus.")}
            </p>
            <p>
              {tr("Puis")} <Path>{tr("Réglages → Calendrier → Comptes → Nouvelles données")}</Path>{" "}
              {tr("(sur les iOS récents : Réglages → Apps → Calendrier) : choisis « Toutes les 15 minutes ».")}
            </p>
          </Step>
          <Step title={tr("Mac")}>
            <p>
              <Path>{tr("Réglages Système → Comptes Internet → Ajouter un compte → Autre → Compte CalDAV")}</Path>, {tr("mêmes informations.")}
            </p>
            <p>
              {tr("Puis")} <Path>{tr("Calendrier → Réglages → Comptes → Actualiser les calendriers")}</Path> {tr(": « Toutes les minutes ».")}
            </p>
          </Step>
        </ol>

        <div className="grid content-start gap-6">
          <section className="grid gap-3">
            <h3 className="mm-label-caps">{tr("Temps de trajet")}</h3>
            <dl className="grid gap-2 text-sm">
              {DELAYS.map(([k, v]) => (
                <div key={k} className="grid gap-0.5 rounded-xl border border-line-subtle px-3 py-2 sm:grid-cols-[14rem_1fr] sm:gap-3">
                  <dt className="text-h2">{tr(k)}</dt>
                  <dd className="text-body">{tr(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-body">
              {tr("Apple ne propose pas l'envoi instantané (push) aux serveurs comme Nextcloud : seul iCloud y a droit. Ouvrir Rappels force la mise à jour, et le bouton « Synchroniser » relance aussitôt l'échange avec Nextcloud.")}
            </p>
          </section>

          <section className="grid gap-3">
            <h3 className="mm-label-caps">{tr("Bon à savoir")}</h3>
            <ul className="grid list-disc gap-1.5 pl-5 text-sm text-body marker:text-meta">
              <li>{tr("Voyagent : titre, description, colonne (à faire, en cours, terminée), priorité, échéance avec l'heure, et les tags (catégories dans Nextcloud ; Rappels ne les affiche pas forcément). L'élément et le déploiement liés restent ici.")}</li>
              <li>{tr("Une heure fixée ici ajoute une alarme à l'heure dite. Elle ne sonne que si l'iPhone a déjà récupéré la tâche : pour un rappel très proche, ouvre Rappels une fois.")}</li>
              <li>{tr("Les alarmes et réglages faits dans Rappels sont conservés quand tu modifies la tâche ici, sauf une alarme à heure fixe si tu changes l'échéance.")}</li>
              <li>{tr("Les rappels déjà terminés dans Nextcloud ne sont pas importés.")}</li>
              <li>{tr("Changer une tâche de liste la recrée dans la nouvelle : Rappels la voit comme une nouvelle tâche.")}</li>
            </ul>
          </section>
        </div>
      </div>
    </details>
  );
}
