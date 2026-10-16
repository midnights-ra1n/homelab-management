# Homelab Management

> [!NOTE]
> **Projet utilisé à titre personnel, développé avec l'aide d'une IA.** Cette application a été conçue et écrite avec un assistant
> d'intelligence artificielle (Claude, d'Anthropic), pour mon usage personnel sur mon homelab. Elle est partagée
> telle quelle, sans garantie ni support : il est très conseillé de relire le code et le tester avant usage, en particulier pour les
> actions Proxmox (démarrage, arrêt, migration) et l'exposition sur un réseau. Une mise en production à grande échelle de cette application n'est pas recommandée.
> Pour information, ce dépôt pourrait faire l'objet d'une visiblité privée prochainement.

Dépôt : [midnights-ra1n/homelab-management](https://github.com/midnights-ra1n/homelab-management). Il remplace aussi [homelab-monitoring](https://github.com/midnights-ra1n/homelab-monitoring), désormais archivé. Le serveur, son paquet et son image s'appellent `homelab-tools`.

Gestion et supervision d'un homelab, réunies dans un seul projet issu de la fusion de **homelab-management** et **homelab-monitoring** :

- un **serveur** en Go, un seul binaire avec **deux rôles** déployés séparément :
  - **monitoring**, en général sur un VPS dédié : les agents s'y connectent, sondes HTTP/TCP/DNS/SSL/SNMP, alertes e-mail groupées, page de statut publique, rapports, API ouverte ;
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
- Intégrations disponibles : Proxmox VE, Homelab Monitoring et Webmin. Beszel, Maintenant et PatchMon ont été retirés.

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

Chaque rôle propose un serveur MCP (outils en lecture seule) pour un assistant comme Claude : « est-ce que j'ai un service inaccessible ? ». Il se règle dans *Paramètres → Serveur MCP* (activation et jeton, affiché une seule fois), à l'adresse `https://<serveur>/api/mcp` (transport HTTP, en-tête `Authorization: Bearer mcp_…`).

- Outils du monitoring : `etat_global`, `lister_hotes`, `details_hote`, `lister_sondes`, `mises_a_jour`.
- Outils de la gestion : `rechercher_inventaire`, `details_element`, `lister_taches`, `lister_deploiements`, `reseau`, `etat_monitoring`.

Le serveur MCP comme les **passkeys** ne fonctionnent **qu'en HTTPS**, derrière un reverse proxy. Celui-ci doit transmettre `X-Forwarded-Proto: https`, et son adresse doit figurer dans `HLT_TRUSTED_PROXIES`. En HTTP, `/api/mcp` refuse toutes les requêtes.

## Journaux, base de données, mises à jour

Ces trois fonctions existent sur les deux rôles :

- **Journaux** (menu *Journaux*) : tout ce qui a été fait depuis l'interface, l'API ou par les tâches automatiques, avec l'auteur (utilisateur, jeton d'API, IP pour les échecs de connexion, « synchronisation »). Les entrées sont conservées **90 jours**. Recherche et filtre par catégorie.
- **Base de données** (*Paramètres*) : taille du fichier, du journal WAL et des données, occupation du disque, taille par table ; **Nettoyer** (rétention), **Compacter** (`VACUUM`) et **taille maximale**. Au-delà de la limite, l'historique le plus ancien (métriques, résultats de sondes, journal) est supprimé ; les réglages et l'inventaire ne sont jamais touchés. SQLite tourne en WAL, `synchronous=NORMAL` et petit cache, avec une seule connexion : peu d'écritures disque, peu de CPU et de RAM.
- **Mises à jour du serveur** (*Paramètres*) : *Rechercher les mises à jour*, puis :
  - installation **.deb** : bouton *Mettre à jour*. Le serveur, non privilégié, écrit seulement le numéro de version demandé ; l'unité root `homelab-tools-update.path` télécharge le paquet de la release GitHub, vérifie son SHA-256 et l'installe ;
  - installation **Docker** : la version disponible est affichée, la mise à jour se fait avec `docker compose pull && docker compose up -d`.

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
| `HLT_TRUSTED_PROXIES` | — | CIDR des reverse proxies autorisés à transmettre `X-Forwarded-*` |
| `HLT_INSTALL` | `deb` / `docker` (fixée par le paquet ou l'image) | Mode de mise à jour proposé dans les paramètres |
| `APP_SECRET` | `DATA_DIR/secret.key` | Clé de chiffrement des secrets d'intégration (gestion) |

Les anciennes variables `HLM_*` de homelab-monitoring sont encore lues.

Premier démarrage : ouvrez l'interface et créez le compte administrateur (12 caractères minimum). Une **passkey** peut ensuite être ajoutée (HTTPS uniquement, derrière un reverse proxy).

## Reprendre les données existantes

- **homelab-monitoring** : le rôle monitoring utilise la même base (`hlm.db`) et la même clé (`hub_ed25519.pem`). Copiez le contenu de l'ancien volume `/data` : les agents déjà installés se reconnectent sans changement.
- **homelab-management** : le rôle gestion ouvre le même `homelab.db`. Copiez `homelab.db` (avec `-wal` et `-shm` s'ils existent), `secret.key` et `uploads/` dans son répertoire de données. Au premier démarrage, une migration :
  - retire les intégrations Beszel, Maintenant et PatchMon ainsi que les sondes intégrées (le monitoring s'en charge) ;
  - ajoute le journal (auteur), le lien inventaire ↔ monitoring et le décommissionnement ;
  - garde les comptes (le mot de passe est rehaché en Argon2id à la première connexion) et les passkeys ; les sessions sont réinitialisées, il faut se reconnecter.

  Les sauvegardes JSON de homelab-management (*Paramètres → Sauvegarde & restauration*) se restaurent aussi.
- Pour relier la gestion au monitoring : dans le monitoring, *Paramètres → API*, activez l'API et créez un jeton `hosts:read`, `monitors:read` et `hosts:write`. Dans la gestion, *Paramètres → Intégrations → Homelab Monitoring*, renseignez l'URL et ce jeton.

## Installer l'agent

| Méthode | Mise à jour |
|---|---|
| Script : *Hôtes → Ajouter un hôte* du monitoring, `curl … install.sh \| sudo HUB_URL=… TOKEN=… KEY=… sh` | automatique, chaque jour |
| Paquet `hlm-agent_<version>_<arch>.deb` | bouton *Mettre à jour l'agent*, Ansible ou nouveau paquet |
| Ansible : rôle `deploy/ansible/roles/hlm_agent` (`hlm_install_method: binary` ou `deb`) | selon la méthode |

Détails : [docs/AGENT.md](docs/AGENT.md), [docs/ANSIBLE.md](docs/ANSIBLE.md). API du monitoring : [docs/API.md](docs/API.md).

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
