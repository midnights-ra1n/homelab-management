# Guide du monitoring

Le rôle **monitoring** supervise les machines (par l'agent) et les services (par les sondes), prévient quand quelque chose tombe, publie une page de statut et produit des rapports. Il tourne de préférence sur une machine extérieure au homelab (un VPS), pour rester joignable quand le homelab ne l'est plus.

Voir aussi : [architecture](ARCHITECTURE.md), [déploiement de l'agent](AGENT.md), [Ansible](ANSIBLE.md), [sondes SNMP](SNMP.md), [API](API.md).

## Sommaire

1. [Premiers pas](#premiers-pas)
2. [États](#états)
3. [Vue d'ensemble et incidents](#vue-densemble-et-incidents)
4. [Hôtes](#hôtes)
5. [Conteneurs, disques, mises à jour](#conteneurs-disques-mises-à-jour)
6. [Sondes](#sondes)
7. [Bande passante](#bande-passante)
8. [Énergie](#énergie)
9. [Alertes](#alertes)
10. [Page de statut publique](#page-de-statut-publique)
11. [Rapports](#rapports)
12. [Réglages](#réglages)
13. [Mises à jour en direct](#mises-à-jour-en-direct)

## Premiers pas

1. Installez le serveur avec `HLT_ROLE=monitoring` ([README](../README.md#installer-le-serveur)) et placez-le derrière un reverse proxy HTTPS.
2. Ouvrez l'interface : la première visite crée le compte administrateur (mot de passe de 12 caractères au moins).
3. *Hôtes → Ajouter un hôte* : choisissez le type de machine et la méthode (commande `curl`, Ansible ou paquet `.deb`), exécutez la commande sur la machine. L'hôte apparaît dès la première connexion de l'agent.
4. *Sondes → Ajouter* : surveillez vos services (site web, port, DNS, certificat…).
5. *Paramètres → Notifications par e-mail* : renseignez le serveur SMTP et envoyez un e-mail de test.

Pour installer l'agent sur beaucoup de machines, *Hôtes → Déploiement en masse* crée un **jeton d'inscription commun** : chaque machine installée avec ce jeton s'inscrit sous son nom à sa première connexion et reçoit son propre jeton ([détails](AGENT.md#plusieurs-machines--le-jeton-commun)).

## États

Hôtes et sondes partagent les mêmes états, du meilleur au pire :

| État | Libellé | Sens |
|---|---|---|
| `operational` | Opérationnel | tout va bien |
| `maintenance` | Maintenance | mis en maintenance : pas d'alerte, exclu des incidents |
| `degraded` | Performances dégradées | fonctionne mal (lent, seuil dépassé, agent arrêté mais machine joignable) |
| `minor_outage` | Panne partielle | répond, mais pas comme attendu (code HTTP, mot-clé, réponse DNS) |
| `major_outage` | Panne majeure | injoignable |
| `unknown` | Inconnu | pas encore de donnée |

L'état global de l'infrastructure est le pire état des hôtes et des sondes actives.

**Hôtes** : un agent silencieux depuis plus de 3 intervalles (+ 15 s) est considéré arrêté. Le hub envoie alors un ping à la machine : si elle répond, l'hôte est *dégradé* (« Agent hors ligne, l'hôte répond toujours au ping ») ; sinon, *panne majeure*. Un disque ou la mémoire remplis à 95 % passent aussi l'hôte en *dégradé*.

**Sondes** : une panne n'est retenue qu'après plusieurs échecs consécutifs (*seuil d'échecs*, 2 par défaut), pour éviter les fausses alertes. Une valeur hors seuil (SNMP, prise) attend de la même façon.

## Vue d'ensemble et incidents

- **Vue d'ensemble** : état global, hôtes, sondes, mises à jour en attente. La disposition se personnalise par blocs (bouton *Personnaliser*) et s'enregistre pour tous les navigateurs.
- **Incidents** : les hôtes et sondes qui ne sont pas opérationnels, du plus grave au moins grave.
- **Recherche** (⌘K / Ctrl K) : pages, hôtes et sondes.

## Hôtes

La liste montre l'état, le système, le processeur, la mémoire, les disques et le réseau de chaque machine. La fiche d'un hôte ajoute :

- **graphiques** (processeur, mémoire, swap, disque, réseau, charge, températures) sur 1 h à 90 jours ;
- **mesures en direct** : l'agent envoie une mesure par seconde tant que la fiche est ouverte ;
- **matériel** : modèle, numéro de série, cartes réseau, disques, adresses IP ;
- **maintenance** : suspend les alertes de l'hôte (pendant une intervention, une mise à jour) ;
- **mise à jour de l'agent**, **nouveau jeton** (réinstallation), **suppression**.

L'intervalle des agents (30 s par défaut) se règle dans *Paramètres → Collecte et rétention*.

## Conteneurs, disques, mises à jour

- **Conteneurs** : les conteneurs Docker de chaque hôte (état, image, ressources), avec les **nouvelles images** disponibles. Le bouton de mise à jour demande à l'agent de tirer l'image et de recréer le conteneur.
- **Disques** : santé SMART de chaque disque, avec un verdict calculé par le hub (*bon état*, *à surveiller*, *à remplacer*, *défaillant*) et les raisons (secteurs réalloués, usure, température…). L'espace occupé de chaque partition est suivi à part.
- **Mises à jour** : paquets en attente par hôte, mises à jour de sécurité, redémarrage requis. *Vérifier* et *Appliquer* passent par l'agent puis par le script root `apt-action.sh` lancé par systemd : ni le hub ni l'agent ne tournent en root.

## Sondes

Chaque sonde a un nom, une catégorie (pour les ranger), une cible, un intervalle (10 s à 24 h, 60 s par défaut), un délai d'attente (10 s par défaut) et un seuil d'échecs.

| Type | Cible | Ce qui est vérifié |
|---|---|---|
| `http` | URL `http(s)://` | code de réponse (`200-399` par défaut, ou une liste), mot-clé dans la page, méthode GET ou HEAD, certificat auto-signé accepté ou non, expiration du certificat en option |
| `tcp` | `hôte:port` | le port accepte la connexion |
| `udp` | `hôte:port` | un message envoyé obtient une réponse (contenant éventuellement un texte attendu) |
| `ping` | adresse IPv4 ou nom | réponse ICMP |
| `dns` | nom de domaine | résolution (A, AAAA, CNAME, MX, TXT, NS), serveur DNS au choix, réponse attendue |
| `ssl` | domaine (port facultatif) | validité et expiration du certificat |
| `snmp` | équipement réseau | une valeur (OID) avec seuils, le débit entrant ou sortant d'une interface, ou son état ; v1, v2c, v3 ([guide SNMP](SNMP.md)) |
| `meross` | IP locale d'une prise Meross | puissance consommée, avec seuils ; une prise multiple par canal |
| `truenas` | `https://truenas.lan` + clé d'API | santé et remplissage des pools, alertes actives (TrueNAS 25.04 et suivants) |

Options communes :

- **Lenteur** (`http`, `tcp`, `dns`) : au-delà d'une latence donnée, la sonde passe en *dégradé*.
- **Certificat** : alerte un nombre de jours avant l'expiration (14 par défaut), une seule fois par certificat.
- **Maintenance**, comme pour les hôtes. Pour publier une sonde, ajoutez-la à un bloc de la [page de statut](#page-de-statut-publique).

Les secrets des sondes (communautés et mots de passe SNMP, clé TrueNAS) sont chiffrés et ne sont jamais renvoyés à l'interface ni exportés.

## Bande passante

Construite à partir des sondes SNMP de débit : débit entrant et sortant de chaque interface, pics, volume du jour et du mois, état des liens. Le mode **En direct** lit les compteurs directement sur les équipements toutes les 2 secondes. La gestion affiche les mêmes données (*Réseau → Trafic*).

## Énergie

Pour les prises connectées Meross :

1. *Paramètres → Prises connectées Meross* : connectez le compte Meross **une fois**. Le hub récupère la clé du compte et la liste des prises, puis se déconnecte ; le mot de passe n'est pas conservé.
2. Créez une sonde `meross` par prise (adresse IP locale). Toutes les mesures se font ensuite sur le réseau local, sans le cloud.

La page *Énergie* montre la puissance instantanée, la consommation par jour, semaine et mois, par prise et au total, avec export CSV.

## Alertes

**E-mail** (*Paramètres → Notifications par e-mail*) :

- serveur SMTP (STARTTLS, TLS implicite ou aucun), expéditeur, destinataires ;
- **fenêtre de regroupement** (60 s par défaut) : tous les changements d'une fenêtre partent dans un seul message ; 0 envoie chaque changement aussitôt ;
- alertes supplémentaires : nouvelles mises à jour de sécurité, redémarrage requis, nouvelles images Docker, santé SMART (à partir de *à surveiller*, *à remplacer* ou *défaillant*), espace disque au-delà d'un seuil (90 % par défaut). Chacune n'est signalée qu'une fois ;
- **modèle d'e-mail** composé par blocs, ou en HTML avancé, avec aperçu.

**Notifications push** vers l'app iOS / macOS : mêmes événements, même regroupement ([guide des applications natives](API-APPLE.md)).

## Page de statut publique

*Page de statut* compose une page publique (`/status`) par blocs : en-tête, état global, liste de services, disponibilité sur 90 jours, latence, texte. **Seuls les hôtes et sondes placés dans un bloc sont publics.** La page s'active dans *Paramètres → Page de statut publique* et ne demande pas de connexion.

## Rapports

- **Rapports** : bilan mensuel (disponibilité, latence, incidents, mises à jour, disques, espace disque), calculé à partir des cumuls journaliers, donc disponible même après la purge des mesures détaillées.
- Envois par e-mail (*Paramètres → Rapports par e-mail*) : rapport du mois le 1er à 8 h, état de santé hebdomadaire le lundi à 8 h, consommation électrique chaque jour, semaine ou mois.

## Réglages

| Section | Contenu |
|---|---|
| Apparence | thème clair, sombre ou automatique |
| Collecte et rétention | intervalle des agents ; durée de conservation des mesures (30 j), des résultats de sondes (30 j) et de la disponibilité journalière (365 j) |
| Base de données | taille, nettoyage, compactage, taille maximale ([détails](../README.md#journaux-base-de-données-mises-à-jour)) |
| Notifications par e-mail, modèle d'e-mail | voir [Alertes](#alertes) |
| Page de statut, rapports, prises Meross | voir les sections ci-dessus |
| API | API publique pour les scripts et outils tiers, jetons, appareils inscrits aux notifications ([API](API.md)) |
| Sauvegarde & restauration | export / import JSON de la configuration (sondes, réglages, hôtes par nom), sans secrets ; les hôtes importés demandent un nouveau jeton d'agent |
| Compte, passkeys | mot de passe (le changer déconnecte les autres sessions, l'app et la gestion), passkeys en HTTPS |
| Serveur MCP | accès en lecture pour un assistant comme Claude ([README](../README.md#serveur-mcp)) |
| Mises à jour | version installée, recherche et installation des nouvelles versions |

Toutes les actions sont inscrites aux **Journaux** (90 jours), avec leur auteur.

## Mises à jour en direct

L'interface ne recharge plus ses pages à intervalle fixe : elle reçoit du serveur un flux d'événements (`/api/events`) et ne recharge une page que lorsque ce qu'elle affiche a changé. Un changement d'état apparaît en moins d'une seconde ; les mesures sont rafraîchies au rythme des agents. Si le flux est coupé (proxy, réseau), les pages reviennent à un rafraîchissement périodique. Voir [architecture, temps réel](ARCHITECTURE.md#temps-réel).
