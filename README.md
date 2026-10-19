# Midnights Management

> [!NOTE]
> **Projet utilisé à titre personnel, développé avec l'aide d'une IA.** Cette application a été conçue et écrite avec un assistant
> d'intelligence artificielle (Claude, d'Anthropic), pour mon usage personnel sur mon homelab. Elle est partagée
> telle quelle, sans garantie ni support : il est très conseillé de relire le code et le tester avant usage, en particulier pour les
> actions Proxmox (démarrage, arrêt, migration) et l'exposition sur un réseau. Une mise en production à grande échelle de cette application n'est pas recommandée.
> Pour information, ce dépôt pourrait faire l'objet d'une visiblité privée prochainement.

Dépôt : [midnights-ra1n/homelab-management](https://github.com/midnights-ra1n/homelab-management). Il remplace aussi [homelab-monitoring](https://github.com/midnights-ra1n/homelab-monitoring), désormais archivé. Le serveur, son paquet et son image s'appellent `homelab-tools`.

Gestion et supervision d'un homelab, réunies dans un seul projet issu de la fusion de **homelab-management** et **homelab-monitoring** :

- un **serveur** en Go, un seul binaire avec **deux rôles** déployés séparément :
  - **monitoring**, en général sur un VPS dédié : les agents s'y connectent, sondes HTTP/TCP/UDP/ping/DNS/SSL/SNMP/TrueNAS rangées par catégories, alertes e-mail groupées (dont SMART et espace disque, seuil réglable), page de statut publique, rapports mensuels et état de santé hebdomadaire facultatif, API ouverte ;
  - **gestion**, sur une VM ou un CT : inventaire, IPAM (VLAN, sous-réseaux, VPN, pare-feu, simulation de flux), noms de domaine, déploiements, tâches (Kanban), carte, page d'applications, Proxmox multi-nœuds sans cluster, Webmin ;
- un **agent** en Rust (binaire statique, `.deb` ou script `curl`), qui alimente à la fois le monitoring et l'inventaire ;
- deux interfaces **React + Tailwind**, PWA et optimisées mobile, avec le même design (Midnights Classic : mêmes polices, tailles, icônes et composants), mais séparées : chaque rôle a la sienne.

L'interface est en français.

## Architecture

```
            agents (hlm-agent)                         navigateur
                   │ WebSocket, authentification mutuelle    │
                   ▼                                         ▼
  ┌──────────────────────────────┐   API /api/v1   ┌──────────────────────────┐
  │ homelab-tools  (monitoring)  │◀────────────────│ homelab-tools (gestion)  │
  │ VPS · hlm.db                 │  jeton hlm_…    │ VM / CT · homelab.db     │
  └──────────────────────────────┘                 └──────────────────────────┘
```

- Les agents ne parlent **qu'au monitoring**.
- La gestion lit l'API du monitoring avec un jeton (scopes `hosts:read`, `monitors:read`, et `hosts:write` pour le décommissionnement) : tableau de bord, alertes, page *Monitoring* et **synchronisation de l'inventaire**.
- Les intégrations **Proxmox** (Paramètres → Intégrations) restent **indépendantes** de l'inventaire et du monitoring. Elles centralisent plusieurs nœuds autonomes sans créer de cluster, donc sans problème de quorum.
- Intégrations disponibles : Proxmox VE, Midnights Monitoring et Webmin. Beszel, Maintenant et PatchMon ont été retirés.

## Inventaire et monitoring

Toutes les 2 minutes (ou avec *Paramètres → Synchroniser maintenant*), la gestion relie chaque hôte équipé de l'agent à un élément de l'inventaire :

1. un élément déjà relié est mis à jour ;
2. sinon, un élément non relié qui porte le même nom d'hôte est relié ;
3. sinon, un élément est créé (tag `monitoring`), de type déduit de la virtualisation (physique, VM, LXC, Docker).

Les champs qui viennent de l'agent sont mis à jour : système et version, processeur (modèle, cœurs, threads, sockets), mémoire, disques, interfaces, fabricant, modèle et n° de série (lisible seulement si l'agent en a le droit), plus la première adresse IP si l'élément n'en a pas. L'état (en ligne / hors ligne) suit celui du monitoring, sauf les états manuels (maintenance, planifié, retiré). Chaque création ou modification est inscrite au journal, avec l'auteur « synchronisation ». La fiche d'un élément relié affiche ses mesures en direct et un lien vers l'hôte dans le monitoring. On peut désactiver la synchronisation dans les paramètres.

## Décommissionnement

Sur la fiche d'un élément, **Décommissionner** le passe à l'état *Retiré* et prépare une liste d'étapes adaptée à ce qui lui est lié :

- sauvegarder les données ;
- arrêter les services ;
- **retirer l'hôte du monitoring** (automatique, via l'API) puis désinstaller l'agent ;
- **réaffecter les éléments hébergés** (automatique) ;
- **supprimer les domaines** (automatique) ;
- **supprimer les règles de pare-feu et les raccourcis** (automatique) ;
- supprimer la VM / le CT ou effacer les disques, selon le type.

Les étapes manuelles se cochent, les automatiques s'exécutent depuis la fiche. La dernière étape supprime l'élément et libère ses adresses IP. Tout est journalisé. On peut annuler le décommissionnement à tout moment : l'élément retrouve alors son état précédent.

## Mettre à jour les agents depuis l'inventaire

La liste de l'inventaire affiche **Mettre à jour N agents** quand des agents reliés ont une version plus ancienne que la dernière release ; un clic les met tous à jour. La fiche d'un élément relié montre la version de son agent et un bouton **Mettre à jour l'agent**. La gestion passe par l'API du monitoring (`POST /api/v1/hosts/{id}/agent-update`, scope `hosts:write`). L'agent se met à jour seul (installation par script) ou via son paquet `.deb` (installation par paquet, par l'assistant root `apt-action.sh`).

Les agents installés avant la fusion téléchargent encore leurs mises à jour depuis le dépôt archivé : réinstallez-les une fois (commande de *Hôtes → Ajouter un hôte*, Ansible ou paquet `.deb`) pour qu'ils suivent ce dépôt.

## Serveur MCP

Chaque rôle propose un serveur MCP (outils en lecture seule) pour un assistant comme Claude : « est-ce que j'ai un service inaccessible ? ». Il s'active dans *Paramètres → Serveur MCP*, à l'adresse `https://<serveur>/api/mcp` (transport HTTP). Trois façons de s'y connecter :

- **Claude, configuration automatique (OAuth)** : dans Claude (web, bureau ou mobile), *Paramètres → Connecteurs → Ajouter un connecteur personnalisé*, collez l'adresse `https://<serveur>/api/mcp`. Claude découvre le serveur d'autorisation (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`), s'inscrit tout seul (inscription dynamique, RFC 7591) puis ouvre la page `/oauth/authorize` de ce serveur : connectez-vous si besoin et cliquez sur **Autoriser**. Avec Claude Code : `claude mcp add --transport http homelab https://<serveur>/api/mcp`, puis `/mcp` pour se connecter. L'inscription automatique n'accepte que les adresses de retour de Claude (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) et les applications locales (`http://localhost…`) ; elle peut être désactivée.
- **Votre propre client OAuth** : *Clients OAuth → Créer le client* donne un **ID client** et un **secret** (affiché une seule fois). Dans Claude, *Ajouter un connecteur personnalisé → Paramètres avancés*, renseignez-les avec l'adresse du serveur. Par défaut le client accepte les adresses de retour de Claude ; on peut en indiquer d'autres (https ou localhost) pour un autre client MCP.
- **Jeton fixe** : pour un client sans OAuth, en-tête `Authorization: Bearer mcp_…` (jeton généré dans la même section, affiché une seule fois).

Sécurité : flux *authorization code* avec PKCE (S256) obligatoire, approuvé par un utilisateur connecté ; jetons d'accès d'une heure, jetons de renouvellement de 90 jours à usage unique (rotation), tous stockés hachés. *Révoquer* un client coupe immédiatement ses accès. Les clients inscrits automatiquement mais jamais utilisés sont supprimés après 24 heures. Chaque autorisation, création et révocation est inscrite au journal.

- Outils du monitoring : `etat_global`, `lister_hotes`, `details_hote`, `lister_sondes`, `mises_a_jour`.
- Outils de la gestion : `rechercher_inventaire`, `details_element`, `lister_taches`, `lister_deploiements`, `reseau`, `etat_monitoring`.

Le serveur MCP comme les **passkeys** ne fonctionnent **qu'en HTTPS**, derrière un reverse proxy. Celui-ci doit transmettre `X-Forwarded-Proto: https`, et son adresse doit figurer dans `HLT_TRUSTED_PROXIES` (voir [HTTPS derrière un reverse proxy](#https-derrière-un-reverse-proxy)). En HTTP, `/api/mcp` refuse toutes les requêtes.

## Journaux, base de données, mises à jour

Ces trois fonctions existent sur les deux rôles :

- **Journaux** (menu *Journaux*) : tout ce qui a été fait depuis l'interface, l'API ou par les tâches automatiques, avec l'auteur (utilisateur, jeton d'API, IP pour les échecs de connexion, « synchronisation »). Les entrées sont conservées **90 jours**. Recherche et filtre par catégorie.
- **Base de données** (*Paramètres*) : taille du fichier, du journal WAL et des données, occupation du disque, taille par table ; **Nettoyer** (rétention), **Compacter** (`VACUUM`) et **taille maximale**. Au-delà de la limite, l'historique le plus ancien (métriques, résultats de sondes, journal) est supprimé ; les réglages et l'inventaire ne sont jamais touchés. SQLite tourne en WAL, `synchronous=NORMAL` et petit cache, avec une seule connexion : peu d'écritures disque, peu de CPU et de RAM.
- **Mises à jour du serveur** (*Paramètres*) : *Rechercher les mises à jour*, puis :
  - installation **.deb** : bouton *Mettre à jour*. Le serveur, non privilégié, écrit seulement le numéro de version demandé ; l'unité root `homelab-tools-update.path` télécharge le paquet de la release GitHub, vérifie son SHA-256 et l'installe ;
  - installation **Docker** : la version disponible est affichée, la mise à jour se fait avec `docker compose pull && docker compose up -d`, ou avec le bouton **Mettre à jour** si le service `watchtower` de `docker-compose.yml` tourne à côté (`HLT_WATCHTOWER_URL` et `HLT_WATCHTOWER_TOKEN`, même jeton que `WATCHTOWER_HTTP_API_TOKEN`). Watchtower télécharge l'image et recrée le conteneur ; le serveur n'a jamais accès au socket Docker.

## Installer le serveur

### Paquet .deb (Debian, amd64 / arm64)

```sh
sudo apt install ./homelab-tools_<version>_$(dpkg --print-architecture).deb
sudo systemctl enable --now homelab-tools@monitoring   # sur le VPS de monitoring, port 8080
sudo systemctl enable --now homelab-tools@management   # sur la VM / le CT de gestion, port 3000
```

Les réglages se trouvent dans `/etc/homelab-tools/<rôle>.env` (adresse d'écoute, URL publique, proxys de confiance) et les données dans `/var/lib/homelab-tools/<rôle>/`. Le service tourne sous l'utilisateur `homelab-tools`, avec un sandbox systemd strict.

### Docker (linux/amd64, linux/arm64)

`docker-compose.yml` décrit les deux services ; sur chaque machine, ne démarrez que le sien :

```sh
docker compose up -d monitoring    # VPS
docker compose up -d management    # VM / CT
```

Image : `ghcr.io/midnights-ra1n/homelab-management`, distroless, non-root, système de fichiers en lecture seule. Le rôle se choisit avec `HLT_ROLE`.

### Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `HLT_ROLE` | `monitoring` | `monitoring` ou `management` |
| `HLT_LISTEN` | `:8080` | Adresse d'écoute |
| `HLT_DATA_DIR` | `./data` (`/data` en Docker) | Base, clés, icônes |
| `HLT_PUBLIC_URL` | — | Adresse publique (commandes d'installation de l'agent, contrôle d'origine) |
| `HLT_TRUSTED_PROXIES` | — | Reverse proxies autorisés à transmettre `X-Forwarded-*` : IP ou CIDR, séparés par des virgules (une entrée invalide est ignorée et signalée dans les journaux) |
| `HLT_INSTALL` | `deb` / `docker` (fixée par le paquet ou l'image) ; `lxc-oci` à définir soi-même pour un CT Proxmox créé depuis l'image OCI | Mode de mise à jour proposé dans les paramètres (en `lxc-oci` : étapes manuelles pour recréer le CT) |
| `HLT_WATCHTOWER_URL`, `HLT_WATCHTOWER_TOKEN` | vides | Docker : adresse et jeton de l'API HTTP de Watchtower, pour le bouton de mise à jour |
| `APP_SECRET` | `DATA_DIR/secret.key` | Clé de chiffrement (AES-256-GCM) des secrets : intégrations et clés SSH (gestion), communautés et mots de passe SNMP (monitoring). Sauvegardez `secret.key` avec la base : sans elle, les secrets ne sont plus lisibles et sont à ressaisir |

Les anciennes variables `HLM_*` de homelab-monitoring sont encore lues.

Premier démarrage : ouvrez l'interface et créez le compte administrateur (12 caractères minimum). Une **passkey** peut ensuite être ajoutée (HTTPS uniquement, derrière un reverse proxy).

## HTTPS derrière un reverse proxy

Le serveur parle HTTP ; le HTTPS est assuré par un reverse proxy (Zoraxy, NPMPlus / Nginx Proxy Manager, Caddy, Traefik, nginx…). Pour savoir que le navigateur est en HTTPS, ce qui est requis par les **passkeys**, le **serveur MCP** et les cookies `Secure`, le serveur vérifie deux choses à chaque requête :

1. la connexion arrive d'une adresse listée dans `HLT_TRUSTED_PROXIES` ;
2. le proxy annonce le schéma d'origine avec `X-Forwarded-Proto: https` (ou l'en-tête standard `Forwarded: proto=https`).

Si l'une des deux manque, l'en-tête est ignoré : sans cette règle, n'importe qui pourrait se prétendre en HTTPS ou usurper une adresse IP.

### 1. Trouver l'adresse à déclarer

Il faut l'adresse **vue par le serveur**, c'est-à-dire celle du proxy du point de vue de la machine qui fait tourner homelab-tools, et non l'IP publique ni le nom de domaine. Le plus simple : ouvrez *Paramètres → Serveur MCP* à travers le proxy. Tant que le HTTPS n'est pas reconnu, un diagnostic indique l'adresse reçue, si elle est de confiance et ce que le proxy a annoncé.

| Situation | Valeur typique |
|---|---|
| Proxy sur une autre machine ou un autre CT / VM | son IP : `192.168.1.10/32` |
| Proxy et serveur sur la même machine, sans Docker | `127.0.0.1/32,::1/128` |
| Proxy et serveur dans le même réseau Docker | le sous-réseau de ce réseau (`docker network inspect <réseau>` → `Subnet`), par ex. `172.18.0.0/16` |
| Proxy en Docker, serveur installé par `.deb` sur l'hôte | la passerelle du réseau du proxy, souvent `172.17.0.1/32` |
| Cloudflare Tunnel | l'adresse de la machine où tourne `cloudflared` (`127.0.0.1/32` s'il est sur la même) |

Plusieurs valeurs se séparent par des virgules. Restez aussi précis que possible : chaque adresse listée peut choisir l'IP client et le schéma que le serveur croira.

### 2. Régler le serveur

- `.deb` : dans `/etc/homelab-tools/monitoring.env` (ou `management.env`), puis `systemctl restart homelab-tools@monitoring` :
  ```sh
  HLT_PUBLIC_URL=https://monitoring.example.fr
  HLT_TRUSTED_PROXIES=192.168.1.10/32
  ```
- Docker : les mêmes variables dans `environment:` de `docker-compose.yml`, puis `docker compose up -d`.
- CT LXC Proxmox (image OCI) : dans les variables d'environnement du CT, puis redémarrez-le.

`HLT_PUBLIC_URL` doit commencer par `https://` et correspondre exactement à l'adresse tapée dans le navigateur.

### 3. Régler le proxy

Le proxy doit transmettre `X-Forwarded-Proto: https`, conserver l'en-tête `Host` et laisser passer les **WebSockets**. Ceux-ci servent aux agents (monitoring) et à la console noVNC Proxmox (gestion).

- **Zoraxy** : créez un *HTTP Proxy* vers `http://<ip-du-serveur>:8080` avec TLS activé sur le domaine. Zoraxy ajoute lui-même `X-Forwarded-Proto` et `X-Forwarded-For` et relaie les WebSockets. Si le diagnostic n'affiche aucun en-tête reçu, ajoutez-le dans les règles de l'hôte : *Edit → Custom Headers*, en-tête `X-Forwarded-Proto`, valeur `https`, sens *To upstream*.
- **NPMPlus / Nginx Proxy Manager** : *Proxy Host* avec le schéma `http`, l'IP et le port `8080`. Cochez **Websockets Support**. Dans l'onglet SSL, prenez un certificat et cochez *Force SSL*. L'en-tête `X-Forwarded-Proto` est déjà envoyé par le modèle de configuration ; rien à ajouter dans *Advanced*.
- **Caddy** : `monitoring.example.fr { reverse_proxy 192.168.1.20:8080 }`. Les en-têtes et les WebSockets sont gérés d'office.
- **Traefik** : un routeur avec `tls` vers le service `http://…:8080`. Les en-têtes `X-Forwarded-*` et les WebSockets sont gérés d'office.
- **nginx** (à la main) :
  ```nginx
  location / {
      proxy_pass http://192.168.1.20:8080;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $http_connection;
      proxy_read_timeout 1h;   # consoles noVNC et agents restent connectés
  }
  ```
- **HAProxy** : `http-request set-header X-Forwarded-Proto https if { ssl_fc }` et `option forwardfor` dans le *backend* ; les WebSockets passent sans réglage.
- **Apache** : `ProxyPreserveHost On`, `RequestHeader set X-Forwarded-Proto "https"` et `ProxyPass / http://192.168.1.20:8080/ upgrade=websocket`.
- **Cloudflare Tunnel** : service `http://localhost:8080`. Cloudflare envoie `X-Forwarded-Proto: https` ; déclarez l'adresse de `cloudflared` comme indiqué ci-dessus.

### 4. Vérifier

Rechargez *Paramètres* en HTTPS : l'avertissement « HTTPS requis » du serveur MCP disparaît et l'ajout d'une passkey devient possible. Sinon, le diagnostic indique la cause : adresse absente de `HLT_TRUSTED_PROXIES` (ajoutez celle affichée) ou en-tête manquant (réglez le proxy).

## Reprendre les données existantes

- **homelab-monitoring** : le rôle monitoring utilise la même base (`hlm.db`) et la même clé (`hub_ed25519.pem`). Copiez le contenu de l'ancien volume `/data` : les agents déjà installés se reconnectent sans changement.
- **homelab-management** : le rôle gestion ouvre le même `homelab.db`. Copiez `homelab.db` (avec `-wal` et `-shm` s'ils existent), `secret.key` et `uploads/` dans son répertoire de données. Au premier démarrage, une migration :
  - retire les intégrations Beszel, Maintenant et PatchMon ainsi que les sondes intégrées (le monitoring s'en charge) ;
  - ajoute le journal (auteur), le lien inventaire ↔ monitoring et le décommissionnement ;
  - garde les comptes (le mot de passe est rehaché en Argon2id à la première connexion) et les passkeys ; les sessions sont réinitialisées, il faut se reconnecter.

  Les sauvegardes JSON de homelab-management (*Paramètres → Sauvegarde & restauration*) se restaurent aussi.
- Pour relier la gestion au monitoring : dans le monitoring, *Paramètres → API*, activez l'API et créez un jeton `hosts:read`, `monitors:read` et `hosts:write`. Dans la gestion, *Paramètres → Intégrations → Midnights Monitoring*, renseignez l'URL et ce jeton.

## Installer l'agent

| Méthode | Mise à jour |
|---|---|
| Script : *Hôtes → Ajouter un hôte* du monitoring, `curl … install.sh \| sudo HUB_URL=… TOKEN=… KEY=… sh` | automatique, chaque jour |
| Paquet `hlm-agent_<version>_<arch>.deb` | bouton *Mettre à jour l'agent*, Ansible ou nouveau paquet |
| Ansible : rôle `deploy/ansible/roles/hlm_agent` (`hlm_install_method: binary` ou `deb`) | selon la méthode |

L'agent envoie ses mesures à l'intervalle choisi dans *Paramètres* (30 s par défaut, 5 s au minimum). Tant que la fiche d'un hôte est ouverte, il passe **en direct** et envoie une mesure toutes les 2 secondes, affichées sans être enregistrées. Un agent d'une version antérieure garde l'affichage habituel.

Si l'agent ne répond plus (service arrêté, bloqué), le monitoring pingue la première adresse IPv4 qu'il avait remontée :

- l'hôte répond : état **Performances dégradées**, avec la mention *Agent hors ligne* ;
- l'hôte ne répond pas : **Panne majeure**.

Dans les deux cas, une alerte e-mail est envoyée. Le ping et la sonde *Ping (ICMP)* passent par une socket ICMP non privilégiée : `net.ipv4.ping_group_range` doit inclure le groupe du serveur. C'est le cas par défaut sous Docker et Debian. Sinon, un agent arrêté reste en panne majeure.

Détails : [docs/AGENT.md](docs/AGENT.md), [docs/ANSIBLE.md](docs/ANSIBLE.md). API du monitoring : [docs/API.md](docs/API.md) ; app iOS / macOS (notifications push, widgets, préférences) : [docs/API-APPLE.md](docs/API-APPLE.md) ; sondes SNMP, bande passante et routeur TP-Link Omada ER605 : [docs/SNMP.md](docs/SNMP.md).

## Développement

```sh
cd web && npm install && npm run build            # interface → server/web/dist (embarquée dans le binaire)
cd server && go run .                             # rôle monitoring sur :8080
cd server && HLT_ROLE=management HLT_LISTEN=:3000 HLT_DATA_DIR=./data-mg go run .
cd web && HLT_API=http://127.0.0.1:3000 npm run dev   # interface en direct sur :5173
cd agent && HUB_URL=http://127.0.0.1:8080 ALLOW_INSECURE=true TOKEN=… KEY=… cargo run
```

Mode test du monitoring : `go run -tags devmode .` crée le compte `admin` / `devmode-password` et des hôtes simulés. Ce mode n'est jamais compilé dans les releases.

Tests : `go test ./...` (server), `cargo test` (agent), `npm run build` (vérification des types incluse).

Organisation :

```
server/        Go : fichiers du monitoring, mg_*.go pour la gestion, journal.go, dbadmin.go, selfupdate.go, passkeys.go
web/src/       interface monitoring (pages/, ui.tsx, layout.tsx), shared/ (journal, base, mises à jour, passkeys)
web/src/mg/    interface gestion : composants de homelab-management (React), app/ = pages, actions/ = appels API
agent/         agent Rust, install.sh / uninstall.sh, unités systemd et assistants root
packaging/     paquets .deb (nfpm) : serveur (homelab-tools@.service, mise à jour) et agent
deploy/        rôle Ansible de l'agent
```

## Publication

[`release.yml`](.github/workflows/release.yml) teste chaque pull request. Sur un push vers `stable`, il publie la release `v0.2.<n>`, qui contient :

- `homelab-tools-linux-{amd64,arm64}` et `homelab-tools_<v>_{amd64,arm64}.deb` ;
- `hlm-agent-linux-{x86_64,aarch64}` et `hlm-agent_<v>_{amd64,arm64}.deb` ;
- une empreinte `.sha256` pour chaque fichier ;
- l'image multi-arch `ghcr.io/<dépôt>:<v>` et `:latest`.

Les builds ARM64 tournent nativement sur des runners Ubuntu 24.04 ARM.
