# Guide de la gestion

Le rôle **gestion** (Midnights Management) est le carnet de bord du homelab : ce qui existe (inventaire), comment c'est relié (réseau, carte), ce qui arrive (déploiements, tâches), et un point d'accès unique aux hyperviseurs Proxmox et aux serveurs Webmin. Il tourne sur une VM ou un CT du homelab et lit l'état des machines auprès du [monitoring](MONITORING.md).

Voir aussi : [architecture](ARCHITECTURE.md), [README](../README.md).

## Sommaire

1. [Premiers pas](#premiers-pas)
2. [Tableau de bord et applications](#tableau-de-bord-et-applications)
3. [Inventaire](#inventaire)
4. [Lien avec le monitoring](#lien-avec-le-monitoring)
5. [Réseau](#réseau)
6. [Carte](#carte)
7. [Déploiements](#déploiements)
8. [Tâches](#tâches)
9. [Proxmox VE](#proxmox-ve)
10. [Webmin](#webmin)
11. [Monitoring et énergie](#monitoring-et-énergie)
12. [Décommissionnement](#décommissionnement)
13. [Paramètres](#paramètres)

## Premiers pas

1. Installez le serveur avec `HLT_ROLE=management` ([README](../README.md#installer-le-serveur)). La première visite crée le compte administrateur.
2. *Paramètres → Intégrations → Midnights Monitoring* : adresse du monitoring, identifiant et mot de passe d'un compte du monitoring. *Tester la connexion*, puis enregistrer. L'inventaire se remplit avec les machines équipées de l'agent.
3. *Paramètres → Intégrations → Proxmox VE* : un nœud par intégration (jeton API ou compte).
4. *Réseau* : déclarez vos VLAN et sous-réseaux ; les adresses des éléments s'y rangent.
5. Pour reprendre une installation de homelab-management, voir [Reprendre les données existantes](../README.md#reprendre-les-données-existantes).

## Tableau de bord et applications

- **Tableau de bord** : nombre d'éléments, d'adresses IP, de déploiements actifs et de tâches ouvertes ; état des nœuds Proxmox ; résumé du monitoring (sondes, systèmes, mises à jour, mises à jour de sécurité) et bandeau d'alerte quand quelque chose est en panne.
- **Applications** : la page d'accueil du homelab. Des raccourcis rangés en groupes (glisser pour réordonner), avec des icônes [Dashboard Icons](https://dashboardicons.com) ou [selfh.st](https://selfh.st/icons/) ou une image envoyée, et l'**état en direct** de chaque service : toute réponse HTTP inférieure à 500 compte comme joignable (401 et 403 compris).

## Inventaire

Chaque élément décrit une machine ou un service.

| Champ | Valeurs |
|---|---|
| Type | physique, VM, LXC, Docker, équipement réseau, autre |
| État | en ligne, hors ligne, maintenance, planifié, retiré |
| Hiérarchie | élément parent (l'hyperviseur d'une VM, l'hôte d'un conteneur) |
| Identité | nom, nom d'hôte, rôle, description, étiquettes, emplacement |
| Matériel | fabricant, modèle, n° de série, processeur (modèle, sockets, cœurs, threads), mémoire et type, GPU, puissance électrique |
| Système | OS et version, disques, cartes réseau, adresses IP (une principale) |
| Accès | URL d'administration |
| Docker | image, ports, extrait de `docker-compose` |
| Proxmox | intégration, nœud et VMID (lien manuel, aucune synchronisation) |
| Notes | texte libre |

- Vues **cartes** ou **tableau**, filtres par type, état, étiquette ; recherche (⌘K / Ctrl K).
- **Actions groupées** sur une sélection (changer l'état ou le parent, ajouter une étiquette, supprimer), **duplication** d'un élément.
- L'**état en ligne / hors ligne** des éléments non suivis par le monitoring vient d'un ping ICMP de l'adresse principale, toutes les minutes. Les états manuels (maintenance, planifié, retiré) ne sont jamais écrasés.

## Lien avec le monitoring

Toutes les 2 minutes (ou *Paramètres → Synchroniser maintenant*), la gestion relie chaque hôte du monitoring à un élément de l'inventaire : élément déjà relié, sinon élément non relié du même nom d'hôte, sinon nouvel élément (étiquette `monitoring`, type déduit de la virtualisation). Le détail est dans le [README](../README.md#inventaire-et-monitoring).

- Les champs remontés par l'agent (système, processeur, mémoire, disques, interfaces, fabricant, modèle, n° de série, première adresse IP) sont mis à jour ; un renommage dans le monitoring renomme l'élément.
- La fiche d'un élément relié affiche ses mesures en direct, la version de son agent et un lien vers l'hôte dans le monitoring.
- **Mettre à jour N agents** (liste de l'inventaire) et **Mettre à jour l'agent** (fiche) passent par le monitoring.
- La synchronisation peut être désactivée dans les paramètres.

**Connexion au monitoring** : un compte du monitoring (identifiant et mot de passe). La gestion l'échange contre un jeton, le garde chiffré et en demande un nouveau s'il est révoqué ; l'API publique du monitoring peut rester désactivée. L'accès de la gestion apparaît dans *Réglages → API* du monitoring (« Connexion de … »), où il se révoque. Changer le mot de passe de ce compte coupe l'accès : mettez-le à jour dans l'intégration. Les intégrations configurées avant avec un jeton collé à la main continuent de fonctionner.

## Réseau

Organisé en onglets :

| Onglet | Contenu |
|---|---|
| Adressage | VLAN (802.1Q), sous-réseaux (CIDR, passerelle, VLAN), adresses (utilisée, réservée, DHCP, libre ; élément, nom DNS, MAC), **prochaine adresse libre**, adresses hors de tout sous-réseau déclaré. Taux d'occupation par sous-réseau et global |
| Trafic | bande passante des interfaces suivies par les sondes SNMP du monitoring, avec le mode en direct |
| VPN | tunnels WireGuard, Tailscale, Headscale, NetBird, ZeroTier, OpenVPN, IPsec ou autre : extrémités, routes de chaque côté, port, état (actif, coupé, planifié) |
| Pare-feu | règles ordonnées (autoriser / refuser ; source et destination : tout, VLAN, sous-réseau, élément, CIDR, tunnel VPN ou Internet ; protocole TCP, UDP, ICMP ou tous ; ports), activation règle par règle, **politique par défaut** (autoriser ou refuser) |
| Domaines | noms de domaine publics ou internes : élément qui sert de reverse proxy, élément cible, URL interne du service |
| Simulation | « ce paquet passe-t-il ? » : d'une source à une destination, avec protocole et port ; résultat, adresses retenues, étapes du trajet (sous-réseaux, VPN, passerelles), règle de pare-feu qui décide et avertissements |
| Diagnostic | incohérences relevées : sous-réseaux qui se chevauchent ou pleins, sans passerelle, plage DHCP mal placée, adresses hors sous-réseau ou en double, MAC ou nom d'hôte en double, tunnels VPN dont les routes se chevauchent, règles de pare-feu orphelines. Le nombre de problèmes s'affiche sur l'onglet |

Le contrôle d'une adresse (au moment de l'attribuer), le diagnostic et la simulation sont calculés dans le navigateur à partir des données de l'IPAM : rien n'est envoyé sur le réseau réel.

## Carte

Topologie interactive : hôtes, invités, conteneurs et tunnels VPN, reliés automatiquement (parent, VPN). Déplacez les nœuds (positions enregistrées), ajoutez des liens à la main en glissant depuis une poignée (Ethernet, fibre, Wi-Fi, VPN, logique), filtrez par type ou par VLAN.

## Déploiements

Ce qui doit être installé, et où ça en est.

- **Type** : physique, VM, LXC, Docker, application, autre. **Priorité** : basse, moyenne, haute, critique. **Échéance**.
- **État** : planifié, préparation, en cours, tests, bloqué, terminé, annulé. Les bloqués et en cours remontent en tête.
- **Ressources prévues** : hôte cible, processeur, mémoire, disque, VMID, sous-réseau et adresse IP, noms de domaine local et public, applications.
- **Checklist** d'étapes à cocher, avec l'avancement.
- **Promouvoir** : crée l'élément d'inventaire correspondant (en ligne si le déploiement est terminé, planifié sinon), avec ses ressources, son parent et son adresse.

## Tâches

Un tableau Kanban (*à faire*, *en cours*, *fait*) pour la maintenance, les idées et les corrections : priorité, échéance, étiquettes, lien vers un élément ou un déploiement. Glissez les cartes d'une colonne à l'autre ; *Vider* retire les tâches terminées.

**Nextcloud et Rappels (iOS, macOS).** Paramètres → Intégrations → Nextcloud : l'URL CalDAV d'une liste de tâches (« Copier le lien privé » dans Nextcloud Tâches), l'identifiant et un mot de passe d'application. La synchronisation tourne chaque minute dans les deux sens (bouton *Synchroniser* sur le tableau) : titre, description, état, priorité, échéance et étiquettes. Pour Rappels, ajoutez le même compte Nextcloud en CalDAV sur l'iPhone ou le Mac (Réglages → Rappels → Comptes → Autre → Compte CalDAV) : les rappels de cette liste passent par Nextcloud. Les alarmes et l'heure d'un rappel sont conservées quand la tâche est modifiée ici. Les rappels déjà terminés ne sont pas importés, et *Vider* ne les supprime pas de Nextcloud.

## Proxmox VE

Agrège des nœuds Proxmox **autonomes**, sans cluster ni Proxmox Datacenter Manager : pas de quorum à maintenir.

**Connexion**, par nœud, dans *Paramètres → Intégrations → Proxmox VE* :

| Méthode | Mise en place |
|---|---|
| Jeton API (conseillé) | *Datacenter → Permissions → API Tokens*. Décochez *Privilege Separation*, ou donnez au jeton le rôle `PVEAuditor` (lecture) ou `PVEVMAdmin` (actions) sur `/` |
| Identifiant et mot de passe | un compte `utilisateur@royaume` (`root@pam`, ou `@pam` ajouté si absent). La gestion obtient un ticket, le renouvelle toutes les 90 min et le redemande s'il est refusé. Un compte avec double authentification ne peut pas être utilisé |

Désactivez la vérification TLS pour le certificat auto-signé d'origine de Proxmox.

**Nœuds** : état, ressources et graphiques, réseau, disques, stockages et leur contenu, services (démarrer, arrêter, redémarrer, recharger), mises à jour (actualiser la liste), tâches, journal système, redémarrage et arrêt du nœud.

**Invités** (VM et CT) : état et graphiques, démarrer, arrêter, éteindre, redémarrer, suspendre, reprendre ; configuration (processeur, mémoire…) ; instantanés (créer, restaurer, supprimer) ; sauvegardes (`vzdump`) ; interfaces ; **console noVNC** dans le navigateur, relayée par la gestion.

**Migration distante** d'un invité vers un autre nœud (`remote_migrate`), même hors cluster : stockage et pont cibles, VMID, en ligne ou non, suppression de l'original en option. Proxmox exige un **jeton API sur le nœud cible**.

Proxmox reste indépendant de l'inventaire : le nœud et le VMID d'un élément se renseignent à la main.

## Webmin

Toutes les instances Webmin au même endroit : lien vers l'interface et sa joignabilité. Avec une clé SSH (*Paramètres → Clés SSH*), la gestion relève aussi l'état du système (charge, mémoire, disques, mises à jour) en lecture seule. Un compte non-root suffit ; ajoutez la clé publique dans son `~/.ssh/authorized_keys`. L'empreinte de l'hôte est mémorisée à la première connexion (« Oublier l'empreinte SSH » après une réinstallation).

## Monitoring et énergie

- **Monitoring** : les hôtes, sondes, alertes et la bande passante de chaque instance de monitoring connectée, sans quitter la gestion.
- **Énergie** : la consommation des prises Meross relevées par le monitoring.

## Décommissionnement

Sur la fiche d'un élément, **Décommissionner** le passe à l'état *retiré* et prépare les étapes adaptées : sauvegarder, arrêter les services, retirer l'hôte du monitoring (automatique), réaffecter les éléments hébergés, supprimer les domaines, les règles de pare-feu et les raccourcis (automatique), supprimer l'invité ou effacer les disques. La dernière étape supprime l'élément et libère ses adresses. Annulable à tout moment. Détails dans le [README](../README.md#décommissionnement).

## Paramètres

| Section | Contenu |
|---|---|
| Intégrations | Proxmox VE, Webmin, Midnights Monitoring : ajout, test de connexion, activation. Les secrets sont chiffrés et jamais renvoyés au navigateur ; laissez un champ secret vide pour garder la valeur enregistrée |
| Clés SSH | génération (Ed25519 ou RSA) ou import ; la clé privée reste chiffrée sur le serveur |
| Synchronisation | inventaire ↔ monitoring : activation et *Synchroniser maintenant* |
| Apparence | thème |
| Compte | mot de passe, passkeys (HTTPS) |
| Sauvegarde & restauration | export JSON de toutes les données de la gestion, restauration (format compatible avec homelab-management) |
| Base de données, mises à jour, serveur MCP | comme sur le monitoring ([README](../README.md#journaux-base-de-données-mises-à-jour)) |

Toutes les modifications sont inscrites aux **Journaux** (90 jours), avec leur auteur (utilisateur, « synchronisation »…).
