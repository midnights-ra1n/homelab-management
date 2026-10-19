# API Midnights Monitoring — v1

API REST intégrée au hub Midnights Monitoring. Elle expose les données de supervision (hôtes, sondes, mises à jour, disques, conteneurs, rapports, énergie) à d'autres outils : Midnights Management, un script, une app iOS / macOS, un tableau de bord. Elle est servie par le même conteneur, sur le même port, sous le préfixe `/api/v1`.

- **Désactivée par défaut pour les jetons créés à la main.** Activez-la dans *Réglages → API* pour un script ou un outil tiers ; tant qu'elle est désactivée, ces jetons reçoivent `404`. L'app iOS / macOS et Midnights Management n'en ont pas besoin : elles se connectent avec un compte ([`POST /auth/login`](#post-apiv1authlogin)), et leurs jetons fonctionnent API désactivée.
- **Authentification par jeton uniquement.** Le cookie de session du tableau de bord n'est jamais accepté sur `/api/v1`.
- **Surtout en lecture.** Les écritures se limitent à la maintenance, à l'inscription d'hôtes, aux appareils pour les notifications push et aux préférences partagées, chacune derrière son propre scope.
- **JSON UTF-8**, horodatages en **secondes Unix** (sauf mention contraire, voir [Conventions](#conventions)).
- Seul le rôle **monitoring** expose cette API. Midnights Management (rôle gestion) la consomme mais n'en publie pas.

> **Vous développez une app iOS, iPadOS ou macOS ?** Lisez ensuite le [guide Apple](API-APPLE.md) : modèles `Codable` complets, client Swift, notifications push, widgets interactifs et synchronisation des préférences.

## Sommaire

1. [Démarrage rapide](#démarrage-rapide)
2. [Conventions](#conventions)
3. [Jetons](#jetons)
4. [Authentification](#authentification)
5. [Scopes](#scopes)
6. [Erreurs et limites](#erreurs-et-limites)
7. [Appels depuis un navigateur (CORS)](#appels-depuis-un-navigateur-cors)
8. [Valeurs d'état](#valeurs-détat)
9. [Index des routes](#index-des-routes)
10. [Routes](#routes)
11. [Applications Apple (iOS, macOS)](#applications-apple-ios-macos)
12. [Exemples d'intégration](#exemples-dintégration)
13. [Sécurité](#sécurité)
14. [Versionnement](#versionnement)
15. [Historique](#historique)

## Démarrage rapide

Pour un script ou un outil tiers. Une app ou Midnights Management se connectent plutôt avec un compte, sans rien activer : voir [`POST /auth/login`](#post-apiv1authlogin).

1. Dans le monitoring, *Réglages → API* : activez l'API et enregistrez.
2. *Créer un jeton* : donnez-lui un nom (celui de l'outil), une expiration et le scope `status:read`. Copiez le jeton : il ne sera plus affiché.
3. Appelez la route d'état :

```sh
export HLM_URL=https://monitoring.example.fr HLM_TOKEN=hlm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
curl -fsS -H "Authorization: Bearer $HLM_TOKEN" "$HLM_URL/api/v1/status"
```

```json
{ "status": "operational", "hosts": { "total": 5, "by_status": { "operational": 5 } }, "monitors": { "total": 12, "by_status": { "operational": 12 } }, "time": 1792046280 }
```

4. Ajoutez ensuite au jeton (ou à un nouveau jeton) les scopes dont votre outil a besoin, et seulement ceux-là.

## Conventions

**URL de base.** `https://<hub>/api/v1`. Derrière un reverse proxy, c'est l'adresse publique du hub (celle de `HLT_PUBLIC_URL` si elle est définie).

**Corps des requêtes.** JSON, avec l'en-tête `Content-Type: application/json` (sinon `415`). Les champs inconnus sont refusés (`400`) : n'envoyez que les champs documentés. Taille maximale 4 Mo (16 Ko pour les préférences), au-delà `413`.

**Réponses.** Toujours du JSON, sauf `204 No Content` (corps vide). Les listes sont renvoyées en entier, sans pagination : elles restent petites (quelques dizaines d'éléments dans un homelab). Les listes renvoyées par une route (`/hosts`, `/monitors`…) valent `[]` quand elles sont vides ; une liste imbriquée peut être absente ou `null` : prévoyez les deux.

**Noms de champs.** `snake_case`. Attention aux conversions automatiques en `camelCase` (Swift `convertFromSnakeCase`, certains réglages Kotlin ou TypeScript) : elles réécrivent aussi les clés des **dictionnaires** (`by_status`, préférences), qui sont des données et pas des noms de champs. Déclarez plutôt la correspondance champ par champ (`CodingKeys` en Swift, voir le [guide Apple](API-APPLE.md#modèles-codable)).

**Valeurs absentes.** Un champ documenté comme facultatif peut être absent **ou** `null` : traitez les deux de la même façon. Une mesure inconnue vaut `null`, jamais `0`.

**Horodatages et unités.**

| Donnée | Format |
|---|---|
| Horodatages (`last_seen`, `created_at`, `time`, `t[]`, `day`, `at`…) | secondes Unix, UTC |
| `last_check` (sondes), `recent[].ts` (résultats) | **millisecondes** Unix |
| `started_at` (conteneurs) | texte ISO 8601 |
| Jours (`days[].day`, `reports/energy.days[]`) | minuit **UTC** du jour, en secondes |
| Octets (mémoire, disques, `mem_used`…) | entiers, en octets |
| Débits réseau des hôtes (`net_rx`, `net_tx`) | octets par seconde |
| Débits SNMP (`snmp_mode` `in` / `out`) | Mbit/s |
| Pourcentages (`cpu`, `mem`, `wear_used_pct`) | 0 à 100 |
| Disponibilité (`uptime`, `availability`) | 0 à 1 |
| Puissance / énergie | W / Wh |
| Températures | °C |

**Textes.** Les messages (`message`, `summary`, `reasons`, erreurs) sont en français et destinés à être affichés tels quels. Ne les analysez pas : utilisez les champs structurés (`status`, `health`…).

**Identifiants.** Entiers positifs, stables tant que l'élément existe. Après une suppression, le même numéro peut être réattribué à un nouvel élément : ne gardez pas d'identifiant en cache sans vérifier le nom.

## Jetons

Dans *Réglages → API → Créer un jeton* :

| Champ | Description |
|---|---|
| Nom | Libellé libre (ex. `homelab-management`). Un jeton par application : chacun se révoque indépendamment. |
| Expiration | 30 jours, 90 jours, 1 an, une date précise (au plus 5 ans), ou jamais. Un jeton expiré est refusé avec `401`. |
| Scopes | Les droits du jeton, voir ci-dessous. Au moins un. |

Le jeton (`hlm_` suivi de 43 caractères base64url) n'est **affiché qu'une seule fois**. Le hub n'en conserve que l'empreinte SHA-256 ; seul le préfixe (`hlm_AbC123…`) reste visible dans la liste. La liste indique aussi la dernière utilisation (précision d'une minute). La révocation est immédiate.

Les jetons obtenus par [connexion d'un compte](#post-apiv1authlogin) apparaissent dans la même liste avec la mention « Connexion de … », sans expiration, et se révoquent de la même façon.

## Authentification

Deux façons d'obtenir un jeton :

- **Connexion avec un compte** (app iOS / macOS, serveur de gestion) : `POST /api/v1/auth/login` échange l'identifiant et le mot de passe d'un compte du monitoring contre un jeton. Ces jetons fonctionnent **même avec l'API désactivée** dans les réglages : la gestion et l'app n'ont rien à activer, et l'API reste fermée aux jetons créés à la main.
- **Jeton créé à la main** (*Réglages → API → Créer un jeton*) pour les autres outils (scripts, Ansible, tableaux de bord) : il exige que l'API soit activée.

Chaque requête porte ensuite l'en-tête :

```http
Authorization: Bearer hlm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```sh
curl -H "Authorization: Bearer $HLM_TOKEN" https://monitoring.example.fr/api/v1/status
```

En HTTP (sans reverse proxy HTTPS), le jeton circule en clair : réservez cet usage à un réseau local de confiance.

## Scopes

| Scope | Routes |
|---|---|
| `status:read` | `GET /api/v1/status`, `GET /api/v1/widgets` |
| `hosts:read` | `GET /api/v1/hosts`, `GET /api/v1/hosts/{id}` |
| `hosts:write` | `POST /api/v1/hosts` (enregistrement d'un hôte depuis un outil d'automatisation), `DELETE /api/v1/hosts/{id}` (décommissionnement depuis la gestion) |
| `metrics:read` | `GET /api/v1/hosts/{id}/metrics` |
| `monitors:read` | `GET /api/v1/monitors`, `GET /api/v1/monitors/{id}`, `GET /api/v1/monitors/{id}/results`, `GET /api/v1/bandwidth`, `GET /api/v1/bandwidth/live` |
| `updates:read` | `GET /api/v1/updates` |
| `smart:read` | `GET /api/v1/disks` |
| `docker:read` | `GET /api/v1/containers` |
| `reports:read` | `GET /api/v1/reports/monthly`, `GET /api/v1/reports/energy` |
| `maintenance:write` | `PUT /api/v1/hosts/{id}/maintenance`, `PUT /api/v1/monitors/{id}/maintenance` |
| `push:write` | `POST /api/v1/devices`, `DELETE /api/v1/devices/{token}` (notifications push de l'app iOS / macOS) |
| `preferences:read` | `GET /api/v1/preferences` |
| `preferences:write` | `PUT /api/v1/preferences` |

Donnez à chaque jeton le minimum nécessaire. Un tableau de bord qui n'affiche que l'état global n'a besoin que de `status:read`.

## Erreurs et limites

Les erreurs ont toujours la forme :

```json
{ "error": "Ce jeton n'a pas le scope monitors:read" }
```

| Code | Signification |
|---|---|
| `200` | Succès |
| `204` | Succès sans contenu (pré-vol CORS) |
| `201` | Créé |
| `400` | Paramètre ou corps invalide (le message énonce la règle attendue) |
| `401` | Jeton absent, invalide, révoqué ou expiré |
| `403` | Jeton valide sans le scope requis |
| `404` | Ressource inconnue, ou API désactivée (jeton créé à la main) |
| `409` | Conflit : nom déjà pris, action déjà en cours, agent non connecté |
| `413` | Corps trop volumineux |
| `415` | En-tête `Content-Type: application/json` manquant |
| `429` | Trop de requêtes. Respectez l'en-tête `Retry-After` (secondes) |
| `500` | Erreur interne (détail dans les journaux du hub) |
| `502` | L'agent n'a pas pu être joint pour transmettre une action |

**Bonnes pratiques côté client.** Réessayez seulement les `429` (après `Retry-After`), les `502` et les erreurs réseau, avec un délai croissant. Ne réessayez pas les `4xx` : la requête ne passera pas mieux. Sur `401`, demandez un nouveau jeton à l'utilisateur (pour une app : affichez de nouveau l'écran de connexion).

- **600 requêtes par minute et par jeton.**
- Les jetons invalides sont aussi limités par adresse IP (protection contre la recherche de jetons).
- Les corps JSON sont limités à 4 Mo ; les champs inconnus sont refusés.
- Les réponses ne sont pas mises en cache (`Cache-Control: no-store`).

Interroger `/status` toutes les 15 à 60 secondes suffit : les agents remontent leurs mesures toutes les 30 secondes par défaut et les sondes ont leur propre intervalle.

## Appels depuis un navigateur (CORS)

Par défaut, aucune origine tierce n'est autorisée : l'API est faite pour être appelée **côté serveur**, où le jeton reste secret. Si votre outil appelle l'API directement depuis le navigateur, ajoutez son origine dans *Réglages → API → Origines autorisées* (ex. `https://gestion.example.fr`, plusieurs séparées par des virgules). Le hub renvoie alors `Access-Control-Allow-Origin` pour cette origine, et répond aux pré-vols `OPTIONS` avec les en-têtes `Authorization` et `Content-Type`, et les méthodes `GET`, `POST` et `PUT`.

Le jeton est alors lisible par quiconque ouvre l'outil : donnez-lui uniquement des scopes de lecture.

## Valeurs d'état

Utilisées par les hôtes, les sondes et l'état global (de la meilleure à la pire) :

| Valeur | Libellé |
|---|---|
| `operational` | Opérationnel |
| `maintenance` | Maintenance |
| `degraded` | Performances dégradées (réponse lente, disque ou mémoire ≥ 95 % ; hôte dont l'agent est hors ligne mais qui répond au ping) |
| `minor_outage` | Panne partielle (service joignable mais réponse incorrecte) |
| `major_outage` | Panne majeure (injoignable : ni agent ni ping, certificat expiré) |
| `unknown` | Pas encore vérifié |

L'état global est le pire état parmi les hôtes et les sondes actives.

## Index des routes

| Méthode | Chemin | Scope | Rôle |
|---|---|---|---|
| `POST` | [`/auth/login`](#post-apiv1authlogin) | — | Échanger identifiant et mot de passe contre un jeton |
| `POST` | [`/auth/logout`](#post-apiv1authlogout) | — | Révoquer le jeton de la requête |
| `GET` | [`/overview`](#get-apiv1overview) | `status:read`, `hosts:read`, `monitors:read` | Écran d'accueil en un appel : résumé, hôtes, sondes |
| `GET` | [`/status`](#get-apiv1status) | `status:read` | État global et comptes par état |
| `GET` | [`/widgets`](#get-apiv1widgets) | `status:read` | Résumé compact pour widgets : état, problèmes, puissance |
| `GET` | [`/hosts`](#get-apiv1hosts) | `hosts:read` | Hôtes et dernières mesures |
| `POST` | [`/hosts`](#post-apiv1hosts) | `hosts:write` | Inscrire un hôte, obtenir la commande d'installation de l'agent |
| `GET` | [`/hosts/{id}`](#get-apiv1hostsid) | `hosts:read` | Un hôte, avec la liste des paquets |
| `DELETE` | [`/hosts/{id}`](#delete-apiv1hostsid) | `hosts:write` | Supprimer un hôte |
| `POST` | [`/hosts/{id}/agent-update`](#post-apiv1hostsidagent-update) | `hosts:write` | Demander la mise à jour de l'agent |
| `GET` | [`/hosts/{id}/metrics`](#get-apiv1hostsidmetricsrange24h) | `metrics:read` | Historique des métriques |
| `PUT` | [`/hosts/{id}/maintenance`](#put-apiv1hostsidmaintenance) | `maintenance:write` | Maintenance d'un hôte |
| `GET` | [`/monitors`](#get-apiv1monitors) | `monitors:read` | Sondes et disponibilité sur 90 jours |
| `GET` | [`/monitors/{id}`](#get-apiv1monitorsid) | `monitors:read` | Une sonde |
| `GET` | [`/monitors/{id}/results`](#get-apiv1monitorsidresultsrange24h) | `monitors:read` | Latence, valeurs et dernières vérifications |
| `GET` | [`/bandwidth`](#get-apiv1bandwidthrange24h) | `monitors:read` | Bande passante et état des interfaces (sondes SNMP) |
| `GET` | [`/bandwidth/live`](#get-apiv1bandwidthlive) | `monitors:read` | Débits lus à l'instant sur les équipements |
| `GET` | [`/snmp/devices`](#get-apiv1snmpdevices) | `monitors:read` | Équipements SNMP et toutes leurs interfaces (découverte) |
| `PUT` | [`/monitors/{id}/maintenance`](#put-apiv1monitorsidmaintenance) | `maintenance:write` | Maintenance d'une sonde |
| `GET` | [`/updates`](#get-apiv1updates) | `updates:read` | Mises à jour en attente |
| `GET` | [`/disks`](#get-apiv1disks) | `smart:read` | Santé SMART des disques |
| `GET` | [`/containers`](#get-apiv1containers) | `docker:read` | Conteneurs Docker |
| `GET` | [`/reports/monthly`](#get-apiv1reportsmonthlymonth2026-09) | `reports:read` | Rapport mensuel |
| `GET` | [`/reports/energy`](#get-apiv1reportsenergydays30) | `reports:read` | Consommation électrique |
| `POST` | [`/devices`](#post-apiv1devices) | `push:write` | Inscrire un appareil Apple aux notifications push |
| `DELETE` | [`/devices/{token}`](#post-apiv1devices) | `push:write` | Désinscrire un appareil |
| `GET` | [`/preferences`](#get-apiv1preferences-et-put-apiv1preferences) | `preferences:read` | Préférences partagées avec le web |
| `PUT` | [`/preferences`](#get-apiv1preferences-et-put-apiv1preferences) | `preferences:write` | Modifier des préférences (fusion par clé) |

Chemins relatifs à `/api/v1`. `OPTIONS` répond aux pré-vols CORS sur toutes les routes.

## Routes

### `POST /api/v1/auth/login`

Sans jeton. Échange le compte contre un jeton d'API rattaché à ce compte, qui apparaît dans *Réglages → API* avec la mention « Connexion de … » et s'y révoque. Fonctionne avec l'API désactivée. Mêmes limites que la connexion web (10 essais par minute et par IP).

```json
{ "username": "admin", "password": "…", "name": "iPhone de Noé", "scopes": ["status:read", "hosts:read"] }
```

- `name` : libellé du jeton (1 à 64 caractères), un par appareil ou serveur.
- `scopes` : facultatif ; sans lui, le jeton a tous les scopes.

Réponse `201` : `{ "token": "hlm_…", "scopes": [ … ] }`. `401` si le compte est inconnu ou le mot de passe faux. Changer le mot de passe du compte révoque tous ses jetons de connexion (et désinscrit leurs appareils des notifications) : l'app et la gestion doivent se reconnecter.

### `POST /api/v1/auth/logout`

Révoque le jeton de la requête, et désinscrit les appareils inscrits avec lui. Réponse `204`.

### `GET /api/v1/overview`

Scopes `status:read`, `hosts:read` et `monitors:read`. L'écran d'accueil de l'app en un seul appel, lu d'un coup : les comptes, les problèmes et les listes concordent toujours, contrairement à trois appels successifs.

```json
{
  "summary": { "status": "minor_outage", "hosts": { "total": 5, "by_status": { … } }, "monitors": { … }, "problems": [ … ], "power": { … }, "time": 1792046280 },
  "hosts": [ /* comme GET /hosts */ ],
  "monitors": [ /* comme GET /monitors, avec days sur 90 jours */ ]
}
```

`summary` est exactement la réponse de [`/widgets`](#get-apiv1widgets). Les widgets et l'extension de notification gardent `/widgets`, bien plus léger.

### `GET /api/v1/status`

Scope `status:read`. Résumé de l'infrastructure.

```json
{
  "status": "degraded",
  "hosts": { "total": 5, "by_status": { "operational": 4, "major_outage": 1 } },
  "monitors": { "total": 12, "by_status": { "operational": 11, "degraded": 1 } },
  "time": 1792046280
}
```

### `GET /api/v1/hosts`

Scope `hosts:read`. Liste des hôtes équipés de l'agent, triée par nom. Ajoutez `?packages=1` pour inclure la liste des paquets en attente (sinon seuls les compteurs sont renvoyés).

```json
[
  {
    "id": 1,
    "name": "pve-01",
    "status": "operational",
    "last_seen": 1792046270,
    "maintenance": false,
    "public": false,
    "connected": true,
    "info": {
      "hostname": "pve-01", "os": "Debian GNU/Linux 13 (trixie)", "kernel": "6.12.0", "arch": "x86_64",
      "cpu_model": "AMD Ryzen 7 5700G", "cpu_cores": 16, "mem_total": 68719476736,
      "agent_version": "v0.1.42", "boot_time": 1791700000
    },
    "latest": {
      "cpu": 12.5, "mem_used": 21474836480, "mem_total": 68719476736, "swap_used": 0, "swap_total": 8589934592,
      "disk_used": 400000000000, "disk_total": 1000000000000, "net_rx": 125000.5, "net_tx": 40000.2,
      "load1": 0.84, "temp": 48.0,
      "disks": [{ "mount": "/", "fs": "ext4", "used": 400000000000, "total": 1000000000000 }],
      "temps": [{ "label": "k10temp Tctl", "c": 48.0 }],
      "ifaces": [{ "name": "enp5s0", "rx": 125000.5, "tx": 40000.2 }]
    },
    "updates": {
      "manager": "apt", "reboot_required": false, "lists_updated_at": 1792030000,
      "checked_at": 1792040000, "pending": 4, "security": 2
    },
    "created_at": 1791000000
  }
]
```

| Champ | Unité / remarque |
|---|---|
| `latest.cpu` | % d'utilisation, tous cœurs |
| `latest.mem_*`, `swap_*`, `disk_*`, `disks[].used/total` | octets |
| `latest.net_rx`, `net_tx`, `ifaces[].rx/tx` | octets par seconde (le total exclut les interfaces virtuelles) |
| `latest.temp` | °C, capteur le plus chaud, `null` si aucun capteur |
| `last_seen` | dernière mesure reçue ; `0` si l'agent ne s'est jamais connecté |
| `connected` | l'agent a une connexion ouverte en ce moment |
| `updates` | `null` tant que l'agent n'a rien remonté (ou système sans apt) |
| `info` | inventaire relevé par l'agent au démarrage. En plus des champs ci-dessus : `os_version`, `cpu_threads`, `cpu_physical`, `cpu_sockets`, `virtualization` (`kvm`, `vmware`, `microsoft`, `xen`, `oracle`, `lxc`, `docker`… ou vide sur une machine physique), `manufacturer`, `model`, `serial`, `install` (`deb` ou `script`), `ips[]` (`iface`, `address`, `prefix`, `mac`), `nics[]` (`name`, `mac`, `speed_mbps`), `disks[]` (`name`, `model`, `size_bytes`, `rotational`, `kind`). Tous facultatifs |
| `action` | dernière action lancée depuis le tableau de bord ou l'API : `action` (`check_updates`, `apply_updates`, `update_agent`, `update_container`), `target`, `state` (`pending`, `running`, `done`, `failed`), `message`, `at` ; `null` si aucune |
| `docker` | conteneurs de l'hôte (format de [`/containers`](#get-apiv1containers)), `null` sans Docker |
| `agent_latest`, `agent_outdated` | dernière version publiée de l'agent (vide si inconnue) et `true` si l'agent de l'hôte est plus ancien |
| `agent_down` | `true` si l'agent est hors ligne (service arrêté ou bloqué, connexion coupée depuis une minute) |
| `reachable` | agent hors ligne : `true` si l'hôte répond encore au ping (état `degraded`, « agent hors ligne, hôte en ligne »), `false` s'il ne répond pas (`major_outage`) ; absent quand l'agent répond ou que le ping n'a pas pu être tenté |

### `DELETE /api/v1/hosts/{id}`

Scope `hosts:write`. Supprime l'hôte et ses métriques, et coupe la connexion de son agent (réponse `204`). C'est l'étape « Retirer l'hôte du monitoring » du décommissionnement du rôle gestion. Désinstallez ensuite l'agent sur la machine, sinon un agent inscrit avec un jeton commun encore valide se réinscrit.

### `POST /api/v1/hosts`

Scope `hosts:write`. Enregistre un hôte et renvoie les identifiants de son agent, pour vos propres outils d'automatisation. Pour un déploiement en masse, le jeton commun (*Hôtes → Déploiement en masse*, [docs/AGENT.md](AGENT.md)) est souvent plus simple.

```http
POST /api/v1/hosts
Content-Type: application/json

{ "name": "pve-02", "rotate_if_exists": false }
```

`201 Created` :

```json
{
  "id": 7,
  "name": "pve-02",
  "created": true,
  "install": {
    "hub_url": "https://monitoring.example.fr",
    "key": "MCowBQYDK2VwAyEAexampleexampleexampleexa=",
    "token": "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd",
    "command": "curl -fsSL … | sudo HUB_URL='…' TOKEN='…' KEY='…' sh"
  }
}
```

- `409` si un hôte porte déjà ce nom.
- Avec `"rotate_if_exists": true`, l'hôte existant reçoit un nouveau jeton (`200`, `"created": false`) : l'ancien agent est déconnecté et l'historique est conservé.
- Le jeton d'agent n'est renvoyé qu'ici ; conservez-le comme un secret.
- `hub_url` est construit à partir de `HLT_PUBLIC_URL` si elle est définie, sinon de l'adresse utilisée pour l'appel.

### `GET /api/v1/hosts/{id}`

Scope `hosts:read`. Un hôte, au même format, avec `updates.packages` :

```json
"packages": [
  { "name": "libssl3", "current": "3.0.11-1~deb12u1", "candidate": "3.0.11-1~deb12u2", "security": true }
]
```

`404` si l'hôte n'existe pas.

### `POST /api/v1/hosts/{id}/agent-update`

Scope `hosts:write`. Demande à l'agent de se mettre à jour vers la dernière version publiée. Pas de corps. Réponse `200` : l'hôte au format de `GET /hosts/{id}`, avec `action.state` à `pending`. Suivez la progression en relisant l'hôte (`action.state` passe à `running` puis `done` ou `failed`).

- `409` si l'agent n'est pas connecté, ou si une action est déjà en cours sur l'hôte.
- `502` si l'agent n'a pas pu recevoir la demande.

### `GET /api/v1/hosts/{id}/metrics?range=24h`

Scope `metrics:read`. Historique moyenné en environ 300 points. `range` : `1h`, `6h`, `24h` (défaut), `7d`, `30d`, `90d` (limité par la rétention configurée). Format en colonnes, chaque tableau aligné sur `t` :

```json
{
  "t":      [1791960000, 1791960300],
  "cpu":    [12.1, 14.8],
  "mem":    [31.2, 31.4],
  "swap":   [0, 0],
  "disk":   [40.0, 40.0],
  "net_rx": [120000.0, 98000.5],
  "net_tx": [40000.0, 35000.1],
  "load1":  [0.8, 1.1],
  "temp":   [47.5, null]
}
```

`cpu`, `mem`, `swap`, `disk` en %, `net_*` en octets/s, `temp` en °C (maximum de la tranche). `null` = pas de donnée.

### `PUT /api/v1/hosts/{id}/maintenance`

Scope `maintenance:write`. Active ou désactive la maintenance (l'hôte passe en `maintenance` et ne déclenche plus d'alerte). Pratique autour d'une mise à jour lancée par votre outil.

```http
PUT /api/v1/hosts/1/maintenance
Content-Type: application/json

{ "maintenance": true }
```

```json
{ "id": 1, "maintenance": true }
```

### `GET /api/v1/monitors`

Scope `monitors:read`. Toutes les sondes, avec la disponibilité des 90 derniers jours.

```json
[
  {
    "id": 3,
    "name": "Nextcloud",
    "type": "http",
    "target": "https://cloud.example.fr/status.php",
    "interval_s": 60,
    "timeout_s": 10,
    "config": { "method": "GET", "expected_status": "200-399", "check_ssl": true, "warn_days": 3 },
    "enabled": true,
    "maintenance": false,
    "public": false,
    "status": "operational",
    "message": "HTTP 200 · certificat valide 58 jours",
    "latency_ms": 142.3,
    "last_check": 1792046250123,
    "cert_expires_at": 1797019346,
    "days": [
      { "day": 1784246400, "uptime": 1, "worst": "operational" },
      { "day": 1784332800, "uptime": 0.9861, "worst": "major_outage" },
      { "day": 1784419200, "uptime": null, "worst": "unknown" }
    ]
  }
]
```

| Champ | Remarque |
|---|---|
| `type` | `http`, `tcp`, `dns`, `ssl`, `snmp` ou `meross` (prise connectée) |
| `config` | dépend du type : `method`, `expected_status`, `keyword`, `ignore_tls`, `check_ssl`, `degraded_ms`, `dns_server`, `record_type`, `expected`, `warn_days`, `failure_threshold` ; `snmp` : `snmp_mode` (vide : un `oid` ; `in` / `out` : débit d'une interface en Mbit/s ; `ifstatus` : état d'une interface, par exemple un tunnel WireGuard), `interface`, `max_percent` (`in` / `out` : état `degraded` au-delà de ce pourcentage de la vitesse du lien), `idle_minutes` (`ifstatus` : panne si rien n'a été reçu sur l'interface depuis ce nombre de minutes, pour détecter un tunnel WireGuard coupé), `oid`, `snmp_version`, `snmp_user`, `auth_proto`, `priv_proto`, `unit` ; `meross` : `channel` ; `snmp` et `meross` : `min_value`, `max_value` (seuils, au-delà l'état passe à `degraded`). Les secrets SNMP (`community`, `auth_pass`, `priv_pass`) ne sont jamais renvoyés |
| `message` | pour `meross`, la mesure lisible (`120,5 W · 230,1 V · 0,54 A`) ; pour `snmp`, la valeur lue |
| `last_check` | **millisecondes** Unix |
| `latency_ms` | dernière latence, `null` en cas d'échec |
| `cert_expires_at` | expiration du certificat suivi (sondes `ssl` ou `http` avec `check_ssl`), sinon `null` |
| `days[]` | un élément par jour (minuit UTC), du plus ancien au plus récent ; `uptime` entre 0 et 1, `null` sans mesure ; `worst` = pire état du jour |

### `GET /api/v1/monitors/{id}`

Scope `monitors:read`. Une sonde, même format. `404` si inconnue.

### `GET /api/v1/monitors/{id}/results?range=24h`

Scope `monitors:read`. Latence et valeur moyennes par tranche (environ 300 points) et les 50 dernières vérifications. `value` est la valeur lue par les sondes `snmp`, ou la puissance en **watts** des sondes `meross` ; `null` pour les autres types. `range` : `1h`, `6h`, `24h`, `7d`, `30d`, `90d`.

```json
{
  "t":       [1791960000, 1791960288],
  "latency": [140.2, null],
  "value":   [null, null],
  "worst":   ["operational", "major_outage"],
  "recent":  [
    { "ts": 1792046250123, "status": "operational", "latency_ms": 142.3, "message": "HTTP 200" }
  ]
}
```

`t` en secondes, `recent[].ts` en millisecondes.

### `GET /api/v1/bandwidth?range=24h`

Scope `monitors:read`. Les sondes SNMP qui lisent une interface (`snmp_mode` `in`, `out` ou `ifstatus`), regroupées par équipement (`target`) et nom d'interface (sans tenir compte de la casse). C'est la vue affichée par la page *Bande passante* et les tableaux de bord du monitoring et de la gestion. `range` : `1h`, `6h`, `24h` (défaut), `7d`, `30d`, `90d`. Seules les sondes actives sont prises en compte.

```json
{
  "range": "24h",
  "t": [1791960000, 1791960720],
  "days": [1789336800, 1789423200],
  "links": [
    {
      "target": "192.168.0.1",
      "interface": "WAN1",
      "status": "operational",
      "speed_mbps": 1000,
      "in":  { "monitor_id": 12, "name": "WAN entrant", "status": "operational", "message": "84,2 Mbit/s · 8,4 % du lien (1 000 Mbit/s)", "current_mbps": 84.2, "avg_mbps": 31.5, "peak_mbps": 412.0, "series": [12.4, null],
               "today_octets": 18400000000, "month_octets": 412000000000, "daily_octets": [10200000000, 18400000000] },
      "out": { "monitor_id": 13, "name": "WAN sortant", "status": "operational", "message": "6,1 Mbit/s · 0,6 % du lien (1 000 Mbit/s)", "current_mbps": 6.1, "avg_mbps": 4.8, "peak_mbps": 38.9, "series": [3.2, null],
               "today_octets": 1300000000, "month_octets": 27500000000, "daily_octets": [900000000, 1300000000] },
      "state": null
    },
    {
      "target": "192.168.0.1",
      "interface": "wg0",
      "status": "operational",
      "speed_mbps": null,
      "in": null,
      "out": null,
      "state": { "monitor_id": 14, "name": "WireGuard", "status": "operational", "message": "Interface wg0 active" }
    }
  ]
}
```

| Champ | Remarque |
|---|---|
| `t` | début de chaque tranche (environ 120 points, 1 minute au minimum), secondes Unix ; `in.series` et `out.series` sont alignés dessus |
| `days` | les 31 derniers minuits **dans le fuseau horaire du hub** (Configuration), secondes Unix ; `daily_octets` est aligné dessus, le dernier élément est aujourd'hui |
| `status` | pire état parmi les sondes de l'interface |
| `speed_mbps` | vitesse de l'interface annoncée par l'équipement (`ifHighSpeed`, sinon `ifSpeed`), `null` tant qu'elle n'a pas été lue depuis le démarrage du hub ou si l'équipement ne la donne pas |
| `in`, `out` | sondes de débit entrant / sortant, `null` s'il n'y en a pas ; débits en **Mbit/s** (l'interface web les affiche en octets par seconde : `Mbit/s × 125 000`) |
| `current_mbps` | dernière mesure ; `avg_mbps` : moyenne sur la période ; `peak_mbps` : plus forte mesure de la période (un relevé, c'est-à-dire le débit moyen entre deux contrôles) |
| `series[]` | moyenne par tranche, `null` sans mesure |
| `today_octets`, `month_octets` | volume de données en **octets** depuis minuit et depuis le 1er du mois (heure locale du hub). Compté exactement à partir des compteurs de l'équipement à chaque contrôle, puis cumulé par heure ; conservé selon la rétention des agrégats quotidiens (365 jours par défaut) |
| `daily_octets[]` | volume par jour, aligné sur `days` |
| `state` | sonde d'état de l'interface (`ifstatus`), par exemple un tunnel WireGuard, sinon `null` |

Créez deux sondes SNMP sur la même interface (mesures « Débit entrant » et « Débit sortant ») pour obtenir les deux sens sur une même ligne.

Précision des mesures :

- un relevé est le débit **moyen entre deux contrôles** ; si l'équipement n'a pas encore rafraîchi son compteur (l'ER605 ne le fait que toutes les 10 à 20 s), la sonde attend le rafraîchissement suivant au lieu d'enregistrer 0 ;
- les compteurs 64 bits (`ifHCInOctets`) sont utilisés en v2c/v3, les compteurs 32 bits en v1 ou si l'équipement n'a pas mieux ; un passage par zéro d'un compteur 32 bits est compté s'il reste plausible pour la vitesse du lien, sinon il est traité comme un redémarrage ;
- chaque lecture vérifie que le numéro d'interface désigne toujours la même interface (nom relu en même temps) ; après une renumérotation (redémarrage du routeur, tunnel recréé), elle est retrouvée immédiatement.

### `GET /api/v1/bandwidth/live`

Scope `monitors:read`. Débit actuel de chaque sonde SNMP `in` / `out`, lu **à l'instant** sur l'équipement (sans attendre l'intervalle de la sonde). Pour un affichage en temps réel, appelez cette route toutes les 2 secondes et tracez les valeurs successives ; associez-les aux interfaces de `/bandwidth` par `monitor_id`.

```json
{
  "at": 1792046281523,
  "samples": [
    { "monitor_id": 12, "mode": "in", "mbps": 84.2 },
    { "monitor_id": 13, "mode": "out", "mbps": null, "error": "Connexion SNMP impossible : …" }
  ]
}
```

- `at` : instant de la lecture, en **millisecondes** Unix.
- `mbps` : débit moyen entre les deux derniers changements du compteur de l'équipement, en Mbit/s. Tant que l'équipement n'a pas rafraîchi son compteur (l'ER605 ne le fait que toutes les 10 à 20 s), la valeur précédente est répétée au lieu de 0 ; au-delà de 30 s sans changement, le débit est réellement nul. `null` à la toute première lecture ou en cas d'erreur (`error` l'explique). La première lecture part du dernier relevé de la sonde.
- Les sondes `in` et `out` d'un même équipement sont lues dans **une seule requête SNMP**, donc au même instant.
- **Lecture partagée** : le hub n'interroge pas les équipements plus d'une fois toutes les 1,5 seconde, quel que soit le nombre de pages ou d'apps ouvertes ; un appel plus rapproché reçoit la même lecture (même `at`).
- Les relevés en temps réel ne sont pas enregistrés : l'historique reste celui des sondes (`/bandwidth`).

### `GET /api/v1/snmp/devices`

Scope `monitors:read`. Lit **à l'instant** chaque équipement interrogé par au moins une sonde SNMP, avec les identifiants enregistrés dans ses sondes, et renvoie toutes ses interfaces. C'est ce que montre le bouton *Découvrir les interfaces* du formulaire des sondes. `?target=192.168.50.1` limite la lecture à un équipement. La lecture parcourt plusieurs tables SNMP (quelques centaines de millisecondes à quelques secondes) : ne l'appelez pas en boucle, utilisez `/bandwidth` pour les débits.

```json
{
  "devices": [
    {
      "target": "192.168.50.1",
      "sys_name": "ER605",
      "sys_descr": "Linux …",
      "uptime_s": 1209600,
      "interfaces": [
        {
          "index": 3, "name": "", "descr": "default/eth1", "alias": "",
          "status": "active", "up": true, "speed_mbps": 1000,
          "in_octets": 1834000000000, "out_octets": 92000000000,
          "addresses": ["203.0.113.24"], "default_route": true,
          "role": "wan", "hint": "Entrant = téléchargement (Internet vers le réseau local), Sortant = envoi vers Internet.",
          "probes": [{ "id": 12, "name": "WAN ↓", "mode": "in" }, { "id": 13, "name": "WAN ↑", "mode": "out" }]
        },
        {
          "index": 22, "name": "", "descr": "default/wg1", "alias": "",
          "status": "active", "up": true, "speed_mbps": null,
          "in_octets": 48000000, "out_octets": 51000000,
          "addresses": ["10.8.0.1"], "default_route": false,
          "role": "vpn", "hint": "Entrant = reçu du pair par le tunnel, Sortant = envoyé vers lui. …",
          "probes": []
        }
      ]
    }
  ]
}
```

| Champ | Remarque |
|---|---|
| `error` | présent si l'équipement n'a pas pu être lu (`interfaces` est alors vide) ; la réponse reste `200` |
| `index` | `ifIndex` ; utilisable dans `config.interface`, mais préférez le nom, retrouvé même après une renumérotation |
| `name`, `descr`, `alias` | `ifName`, `ifDescr`, `ifAlias` ; vides si l'équipement ne les publie pas. L'ER605 préfixe ses noms par `default/`, facultatif dans `config.interface` |
| `status`, `up` | `ifOperStatus` en français ; `up` vaut `true` si l'interface est active |
| `speed_mbps` | `ifHighSpeed`, sinon `ifSpeed` ; `null` si inconnue (souvent le cas des tunnels) |
| `in_octets`, `out_octets` | octets reçus / envoyés **depuis le démarrage de l'équipement** (64 bits si disponibles) |
| `addresses` | adresses IPv4 de l'interface (`ipAdEntIfIndex`) |
| `default_route` | la route par défaut de l'équipement sort par cette interface (`ipCidrRouteTable`, `inetCidrRouteTable` ou `ipRouteTable`) : c'est le WAN |
| `role` | rôle **deviné** à partir de la route et du nom Linux : `wan`, `lan` (VLAN `inf.N`, `br…`), `vpn` (`wg…`, `tun…`, `l2tp…`), `system` (tunnels et modèles du noyau), `loopback`, ou `""` si inconnu. Les interfaces sont triées par rôle (WAN d'abord) puis par numéro |
| `hint` | ce que signifient Entrant et Sortant sur cette interface, en français |
| `probes` | sondes qui lisent déjà cette interface (`mode` : `in`, `out`, `ifstatus`) |

Le [guide SNMP](SNMP.md) explique comment configurer l'équipement (TP-Link Omada ER605 en exemple), choisir l'interface et le sens, et interpréter les mesures.

### `PUT /api/v1/monitors/{id}/maintenance`

Scope `maintenance:write`. Même corps et même réponse que pour les hôtes.

### `GET /api/v1/updates`

Scope `updates:read`. Mises à jour en attente sur chaque hôte, avec la liste des paquets.

```json
[
  {
    "host_id": 1,
    "host": "pve-01",
    "updates": {
      "manager": "apt",
      "packages": [{ "name": "openssh-server", "current": "1:9.2p1-2+deb12u2", "candidate": "1:9.2p1-2+deb12u3", "security": true }],
      "reboot_required": false,
      "lists_updated_at": 1792030000,
      "checked_at": 1792040000,
      "pending": 1,
      "security": 1
    }
  }
]
```

L'agent analyse les mises à jour au démarrage puis toutes les 6 heures, à partir des listes apt actualisées par `apt-daily.timer`. `lists_updated_at` indique leur fraîcheur.

### `GET /api/v1/disks`

Scope `smart:read`. Santé SMART des disques, par hôte. Les hôtes sans collecte SMART n'apparaissent pas.

```json
[
  {
    "host_id": 2,
    "host": "nas",
    "collected_at": 1792044000,
    "disks": [
      {
        "name": "/dev/sda", "model": "WDC WD40EFRX-68N32N0", "serial": "WD-WX12", "kind": "hdd",
        "capacity_bytes": 4000787030016, "smart_passed": true, "temperature_c": 36, "power_on_hours": 27000,
        "reallocated": 8, "pending": 0, "offline_uncorrectable": 0, "reported_uncorrect": 0, "crc_errors": 0,
        "wear_used_pct": null, "data_written_bytes": null,
        "health": "watch",
        "score": 70,
        "usable": true,
        "summary": "Utilisable, à surveiller.",
        "reasons": ["8 secteur(s) remplacé(s) : à surveiller"],
        "life_left_days": 700,
        "life_basis": "Durée de vie habituelle d'un disque dur : 5 ans en fonctionnement continu"
      }
    ]
  }
]
```

| Champ | Remarque |
|---|---|
| `kind` | `hdd`, `ssd` (SATA) ou `nvme` |
| `health` | `good` (bon état), `watch` (à surveiller), `replace` (à remplacer), `failing` (défaillant) |
| `score` | 0 à 100 : usure (SSD) ou âge (HDD), moins une pénalité selon `health` |
| `usable` | `true` pour `good` et `watch` |
| `reasons` | explications en français, vides si tout va bien |
| `life_left_days` | **estimation** : extrapolation de l'usure (SSD) ou durée de vie habituelle de 5 ans (HDD) ; `0` si remplacement conseillé ; `null` si non estimable |
| `error` | présent si `smartctl` est absent de l'hôte |

Les champs SMART bruts valent `null` quand le disque ne les expose pas (les machines virtuelles n'en exposent généralement aucun).

### `GET /api/v1/containers`

Scope `docker:read`. Conteneurs Docker par hôte (hôtes avec Docker uniquement), relevés toutes les minutes.

```json
[
  {
    "host_id": 4,
    "host": "docker-01",
    "docker": {
      "collected_at": 1792046220,
      "running": 4,
      "updates_available": 1,
      "containers": [
        {
          "id": "a1b2c3d4e5f6", "name": "nextcloud-app-1", "image": "nextcloud:29-apache",
          "state": "running", "health": "healthy", "started_at": "2026-10-12T08:01:12.5Z", "restart_count": 0,
          "cpu_pct": 3.2, "mem_used": 440401920, "mem_limit": 8589934592, "net_rx": 900000000, "net_tx": 300000000,
          "compose_project": "nextcloud", "compose_service": "app", "update": "available"
        }
      ]
    }
  }
]
```

| Champ | Remarque |
|---|---|
| `state` | `running`, `exited`, `restarting`, `paused`, `created`, `dead` |
| `health` | `healthy`, `unhealthy`, `starting`, ou vide sans healthcheck |
| `mem_*`, `net_*` | octets ; `net_*` cumulés depuis le démarrage du conteneur ; `null` si arrêté |
| `update` | `available`, `up_to_date`, `unknown` (registre privé ou injoignable), `local` (image construite sur place), `pinned` (référencée par empreinte) |
| `compose_*` | vides hors Docker Compose |
| `error` | présent si Docker n'a pas répondu |

### `GET /api/v1/reports/monthly?month=2026-09`

Scope `reports:read`. Rapport d'un mois (`AAAA-MM`, mois précédent par défaut). Le mois en cours est calculé jusqu'à maintenant.

```json
{
  "month": "2026-09",
  "from": 1788220800,
  "to": 1790812800,
  "uptime": 0.9987,
  "host_availability": 0.9991,
  "incident_days": 2,
  "monitors": [
    { "id": 3, "name": "Nextcloud", "type": "http", "uptime": 0.9952, "avg_latency_ms": 151.2, "incident_days": 1, "worst": "major_outage" }
  ],
  "hosts": [
    { "id": 1, "name": "pve-01", "availability": 0.9995, "cpu_avg": 14.2, "mem_avg": 33.1 }
  ],
  "certificates_expiring": [],
  "pending_updates": 6,
  "security_updates": 4,
  "disks_attention": [],
  "generated_at": 1792046280
}
```

- `uptime` est la moyenne des disponibilités des sondes ayant des mesures sur le mois.
- `incident_days` compte les jours où une sonde a connu une panne partielle ou majeure.
- `host_availability` est la part des relevés d'agent reçus par rapport à ceux attendus (avec l'intervalle d'agent actuel).
- `certificates_expiring`, `pending_updates`, `security_updates` et `disks_attention` décrivent la situation **au moment de la génération**, pas l'historique. `certificates_expiring` contient des sondes au format de `/monitors`, et `disks_attention` des disques au format de `/disks`, avec l'hôte dans `name`.
- Les données s'appuient sur les relevés journaliers, conservés 365 jours par défaut (*Réglages → Collecte et rétention*).

### `GET /api/v1/reports/energy?days=30`

Scope `reports:read`. Consommation des prises Meross sur les `days` derniers jours, aujourd'hui inclus (1 à 3650, 30 par défaut). Valeurs en **Wh**.

```json
{
  "from": 1789776000,
  "to": 1792368000,
  "days": [1789776000, 1789862400],
  "total_wh": 41250.4,
  "avg_day_wh": 1375.0,
  "avg_week_wh": 9625.1,
  "avg_month_wh": 41855.3,
  "plugs": [
    { "id": 9, "name": "Baie réseau", "total_wh": 41250.4, "avg_day_wh": 1375.0, "avg_week_wh": 9625.1, "avg_month_wh": 41855.3, "daily": [1360.2, null] }
  ]
}
```

- `days[]` : minuit UTC de chaque jour ; `plugs[].daily[]` est aligné dessus, `null` les jours sans relevé.
- Les moyennes ne comptent que les jours mesurés ; semaine = moyenne journalière × 7, mois = × 30,44.
- L'énergie est estimée à partir de la puissance relevée à chaque vérification (puissance × intervalle) : un intervalle court donne une estimation plus fine.

### `GET /api/v1/widgets`

Scope `status:read`. Un seul appel pour les widgets de l'écran d'accueil : le résumé de `/status`, les éléments en difficulté et la consommation des prises connectées.

```json
{
  "status": "minor_outage",
  "hosts": { "total": 5, "by_status": { "operational": 4, "minor_outage": 1 } },
  "monitors": { "total": 12, "by_status": { "operational": 12 } },
  "problems": [
    { "kind": "host", "id": 2, "name": "nas", "status": "degraded", "message": "Agent hors ligne, l'hôte répond toujours au ping" }
  ],
  "power": { "plugs": 3, "now_w": 182.4, "avg_24h_w": 171.9 },
  "time": 1792046280
}
```

- `problems` : au plus 10 éléments dont l'état est `degraded` ou pire (`kind` vaut `host` ou `monitor`).
- `power.now_w` : somme des dernières mesures des prises actives ; `avg_24h_w` : somme des moyennes sur 24 h ; `null` sans mesure.

### `POST /api/v1/devices`

Scope `push:write`. Inscrit un appareil aux notifications push (APNs). À appeler à chaque lancement de l'app avec le `deviceToken` reçu par `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` : l'appel est idempotent.

```json
{ "token": "a1b2…(hexadécimal)", "name": "iPhone de Midnights", "sandbox": false }
```

| Champ | Obligatoire | Règle |
|---|---|---|
| `token` | oui | `deviceToken` en hexadécimal (32 à 100 octets, majuscules acceptées, enregistré en minuscules) |
| `name` | oui | 1 à 100 caractères, affiché dans *Réglages → API → Appareils* |
| `sandbox` | non (`false`) | `true` pour une app lancée depuis Xcode (environnement APNs de développement), `false` pour TestFlight et l'App Store |

- Un jeton déjà inscrit est mis à jour (nom, environnement, jeton d'API rattaché) : pas de doublon.
- Réponse `201` : `{ "token": "a1b2…", "push_enabled": true }`. `push_enabled` est `false` tant que le serveur n'a pas de clé APNs.
- L'appareil est rattaché au jeton d'API : révoquer le jeton désinscrit l'appareil. Un appareil désinstallé (réponse `410` d'Apple) est retiré automatiquement.

`DELETE /api/v1/devices/{token}` désinscrit l'appareil (`204`, y compris s'il n'était pas inscrit). À appeler quand l'utilisateur se déconnecte de l'app ou désactive les notifications.

**Configuration du serveur** (variables d'environnement, puis redémarrage) :

| Variable | Valeur |
|---|---|
| `HLT_APNS_KEY` | chemin du fichier `.p8` (Certificates, Identifiers & Profiles → Keys, service *Apple Push Notifications*) |
| `HLT_APNS_KEY_ID` | identifiant de la clé (10 caractères) |
| `HLT_APNS_TEAM_ID` | identifiant de l'équipe |
| `HLT_APNS_TOPIC` | identifiant (bundle id) de l'app, ex. `fr.midnights.monitoring` |

La page *Réglages → API → Appareils* liste les appareils, la dernière erreur d'envoi, et envoie une notification de test.

**Contenu des notifications.** Les changements d'état d'une même fenêtre de regroupement (comme pour les e-mails) produisent une seule notification :

```json
{
  "aps": {
    "alert": { "title": "nas : Performances dégradées", "body": "Agent hors ligne, l'hôte répond toujours au ping" },
    "sound": "default", "thread-id": "midnights-monitoring", "mutable-content": 1, "interruption-level": "time-sensitive"
  },
  "events": [
    { "kind": "Hôte", "name": "nas", "from": "operational", "to": "degraded", "message": "Agent hors ligne, l'hôte répond toujours au ping", "at": 1792046280 }
  ]
}
```

| Champ de `events[]` | Valeurs |
|---|---|
| `kind` | `Hôte`, `Sonde`, `Certificat SSL`, `Disque`, `Mises à jour`, `Redémarrage`, `Image Docker`, `Test` (bouton de test). Texte français, utilisable comme libellé |
| `name` | nom de l'hôte, de la sonde ou du disque concerné |
| `from`, `to` | états avant / après (voir [Valeurs d'état](#valeurs-détat)) pour `Hôte` et `Sonde` ; absents pour les avertissements (certificat, disque, mises à jour…) |
| `message` | détail lisible, facultatif |
| `at` | moment du changement, secondes Unix |

Une notification compte au plus 4 lignes dans `body` ; `events` contient toujours tous les changements.

`interruption-level` vaut `time-sensitive` quand au moins un élément passe en panne (ajoutez la capacité *Time Sensitive Notifications* à l'app), `active` sinon. `events` permet à l'app (ou à une *Notification Service Extension*) d'ouvrir le bon écran et de recharger les widgets (`WidgetCenter.shared.reloadAllTimelines()`).

### `GET /api/v1/preferences` et `PUT /api/v1/preferences`

Scopes `preferences:read` / `preferences:write`. Préférences partagées entre l'interface web et les apps : un objet JSON libre (16 Ko au plus). `PUT` **fusionne** les clés envoyées (une valeur `null` supprime la clé) et renvoie l'objet complet, si bien que deux appareils qui modifient des clés différentes ne s'écrasent pas.

```json
{ "theme": "dark", "monitors_view": "table", "ios.widget.kind": "power" }
```

| Clé | Lue par le web | Valeurs |
|---|---|---|
| `theme` | oui | `auto`, `light`, `dark` |
| `monitors_view` | oui | `cards`, `table` |
| autres | non | libres : préfixez les clés propres à l'app (`ios.…`) |

- Clés : 1 à 64 caractères ; valeurs : tout JSON (texte, nombre, booléen, objet, tableau).
- `GET` renvoie `{}` tant que rien n'a été enregistré.
- `400` si une clé est invalide ou si le résultat dépasse 16 Ko ; rien n'est alors enregistré.
- La fusion porte sur les clés de premier niveau : envoyer `{"ios.widgets": {"kind": "power"}}` remplace tout l'objet `ios.widgets`.
- Pas de contrôle de version : la dernière écriture d'une clé l'emporte.

Le web relit les préférences à chaque ouverture et enregistre chaque changement de thème ou de vue.

## Applications Apple (iOS, macOS)

Les routes `/widgets`, `/devices` et `/preferences` ont été conçues pour l'app native. Le [guide Apple](API-APPLE.md) décrit l'ensemble : configuration d'Xcode et du serveur, modèles `Codable` de toutes les réponses, client Swift (`async`/`await`), stockage du jeton dans le trousseau, notifications push, widgets interactifs, App Intents et synchronisation des préférences.

## Exemples d'intégration

### Shell

```sh
export HLM_URL=https://monitoring.example.fr HLM_TOKEN=hlm_xxx

# État global
curl -fsS -H "Authorization: Bearer $HLM_TOKEN" "$HLM_URL/api/v1/status" | jq -r .status

# Hôtes en panne
curl -fsS -H "Authorization: Bearer $HLM_TOKEN" "$HLM_URL/api/v1/hosts" \
  | jq -r '.[] | select(.status == "major_outage") | .name'

# Mettre un hôte en maintenance pendant une mise à jour
curl -fsS -X PUT -H "Authorization: Bearer $HLM_TOKEN" -H "Content-Type: application/json" \
  -d '{"maintenance":true}' "$HLM_URL/api/v1/hosts/1/maintenance"
```

### TypeScript (côté serveur)

```ts
const HLM_URL = process.env.HLM_URL!;
const HLM_TOKEN = process.env.HLM_TOKEN!;

type Status = "operational" | "degraded" | "maintenance" | "minor_outage" | "major_outage" | "unknown";

async function hlm<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${HLM_URL}/api/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${HLM_TOKEN}`, "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 429) throw new Error(`Rate limited, retry in ${res.headers.get("Retry-After")} s`);
  const body = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${body.error}`);
  return body as T;
}

const summary = await hlm<{ status: Status; hosts: { total: number }; monitors: { total: number } }>("/status");
const hosts = await hlm<{ id: number; name: string; status: Status; latest: { cpu?: number } }[]>("/hosts");
await hlm(`/hosts/${hosts[0].id}/maintenance`, { method: "PUT", body: JSON.stringify({ maintenance: true }) });
```

### Python

```python
import os, requests

s = requests.Session()
s.headers["Authorization"] = f"Bearer {os.environ['HLM_TOKEN']}"
base = os.environ["HLM_URL"] + "/api/v1"

r = s.get(f"{base}/disks", timeout=10)
r.raise_for_status()
for host in r.json():
    for d in host["disks"]:
        if not d["usable"]:
            print(f"{host['host']} {d['name']} {d['model']}: {d['summary']}")
```

## Sécurité

- Le hub ne stocke que l'empreinte SHA-256 des jetons ; une fuite de la base ne révèle aucun jeton utilisable.
- `/api/v1` n'accepte que les jetons : pas de cookie, donc pas de risque de CSRF depuis un site tiers.
- Les champs `target` des sondes (adresses internes) sont exposés par `monitors:read` : ne donnez ce scope qu'à des outils de confiance.
- Préférez des jetons à durée limitée, et révoquez immédiatement un jeton qui aurait fuité.
- Désactiver l'API dans les réglages coupe instantanément les jetons créés à la main, sans les supprimer. Les jetons obtenus par connexion d'un compte restent valides : révoquez-les un par un, ou changez le mot de passe du compte pour tous les couper.

## Versionnement

Le préfixe `/api/v1` est stable. Des champs peuvent être **ajoutés** aux réponses sans changer de version : ignorez les champs inconnus. Toute suppression ou modification incompatible fera l'objet d'un préfixe `/api/v2`, avec `v1` maintenu en parallèle.

## Historique

| Date | Changement |
|---|---|
| 2026-10 | Routes `POST /auth/login`, `POST /auth/logout` (jetons rattachés à un compte, valides avec l'API désactivée) et `GET /overview`. |
| 2026-10 | Routes `GET /bandwidth` et `GET /bandwidth/live` (scope `monitors:read`). Routes `GET /widgets`, `POST` / `DELETE /devices`, `GET` / `PUT /preferences` ; scopes `push:write`, `preferences:read`, `preferences:write`. Champs `agent_down` et `reachable` des hôtes ; un hôte dont l'agent est arrêté mais qui répond au ping passe en `degraded` au lieu de `major_outage`. Sondes SNMP : `snmp_mode` et `interface` (débit et état d'interface). Route `GET /snmp/devices`. Bande passante : `speed_mbps`, `days`, `today_octets`, `month_octets`, `daily_octets` ; `peak_mbps` devient la plus forte mesure de la période. Sondes SNMP : `max_percent`, `idle_minutes`. |
