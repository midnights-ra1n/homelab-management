# Déployer l'agent

L'agent `hlm-agent` est un binaire Rust statique (musl) pour Debian, en `x86_64` et `aarch64`. Il fonctionne sur toutes les versions de Debian, quelle que soit leur glibc. Il tourne comme service systemd sous l'utilisateur `hlm-agent`, sans privilèges, et démarre au boot. Installé par le script, il se met à jour chaque jour ; installé par le **paquet .deb**, il ne se met à jour que sur demande (bouton *Mettre à jour l'agent* de sa fiche, Ansible ou nouveau paquet).

En plus des métriques, l'agent envoie l'**inventaire matériel** de la machine (processeur, mémoire, disques, interfaces réseau, adresses IP, système, virtualisation, fabricant et modèle). Le rôle gestion s'en sert pour créer et tenir à jour l'élément correspondant de l'inventaire (voir le README, « Inventaire et monitoring »).

| Besoin | Méthode |
|---|---|
| Une machine | *Hôtes → Ajouter un hôte* : assistant en 3 étapes, une ligne à copier |
| Plusieurs machines | *Hôtes → Déploiement en masse* : un **jeton commun**, la même ligne (ou les mêmes variables Ansible) partout |
| Un parc géré par Ansible | Le rôle `hlm_agent` : voir **[docs/ANSIBLE.md](ANSIBLE.md)** |
| Un Proxmox et ses conteneurs LXC | Assistant, type *Serveur Proxmox* : voir [Proxmox et LXC](#proxmox-et-conteneurs-lxc) |
| Paquet Debian | [Paquet .deb](#paquet-deb) |
| Retirer l'agent | Une ligne : [Désinstaller](#désinstaller) |

## Ajouter une machine

*Hôtes → Ajouter un hôte* :

1. **Machine** : nom, type (machine virtuelle, Proxmox, serveur physique, poste client), SMART et mise à jour automatique.
2. **Installation** : l'**adresse du hub** (modifiable, et mémorisée pour les prochains hôtes), puis la commande à copier, ou les variables Ansible, ou l'installation manuelle.
3. **Connexion** : l'assistant attend la première connexion de l'agent et affiche les premières mesures.

```sh
curl -fsSL https://raw.githubusercontent.com/midnights-ra1n/homelab-management/stable/agent/install.sh \
  | sudo HUB_URL='https://monitoring.example.fr' TOKEN='…' KEY='…' sh
```

L'adresse du hub utilisée dans les commandes est, par ordre de priorité :
1. celle saisie dans l'assistant ;
2. sinon `HLT_PUBLIC_URL` du conteneur ;
3. sinon l'adresse avec laquelle vous avez ouvert le tableau de bord.

## Paquet .deb

Chaque release publie `hlm-agent_<version>_amd64.deb` et `_arm64.deb`, avec leur empreinte SHA-256.

```sh
sudo install -d -m 0750 /etc/hlm-agent
printf 'HUB_URL=https://monitoring.example.fr\nTOKEN=…\nKEY=…\n' | sudo tee /etc/hlm-agent/agent.env >/dev/null
sudo apt install ./hlm-agent_*_$(dpkg --print-architecture).deb
```

Le paquet installe exactement les mêmes fichiers que `install.sh` (il l'exécute depuis `/usr/share/hlm-agent`). Sans `agent.env`, il s'installe sans démarrer : créez le fichier puis `sudo dpkg-reconfigure hlm-agent`. Options d'installation (`SMART`, `REMOTE_UPDATES`, `DOCKER`, `NODE_APPS`, `NODE_APPS_ACTIONS`) : dans `/etc/hlm-agent/install.env`. `apt remove hlm-agent` retire l'agent complètement.

Mise à jour : le bouton *Mettre à jour l'agent* passe par l'assistant root `apt-action.sh`, qui télécharge le `.deb` de la dernière release, vérifie son SHA-256 et l'installe (il faut `REMOTE_UPDATES` activé, valeur par défaut).

## Plusieurs machines : le jeton commun

*Hôtes → Déploiement en masse* crée un jeton commun (`enr_…`), valable 24 heures, 7 jours, 30 jours ou sans limite. On y choisit ensuite le **type de machine**, comme dans l'assistant : il règle SMART (`hlm_smart` pour Ansible) et, pour un *Serveur Proxmox*, propose d'installer aussi l'agent dans les conteneurs LXC (méthode Commande). Les conteneurs n'utilisent pas ce jeton : chacun reçoit le sien.

- **La même commande et la même clé** sur toutes les machines.
- À sa première connexion, chaque agent s'inscrit sous **son nom de machine** (`pve-01`, `nas`…). En cas de doublon, un suffixe est ajouté (`pve-01-2`).
- L'agent reçoit alors son **propre jeton**, enregistré dans `/var/lib/hlm-agent/state/token`, et n'utilise plus le jeton commun.
- Le jeton commun ne permet donc que d'inscrire de nouvelles machines, jamais d'usurper une machine existante. Une fois le déploiement fini, vous pouvez le révoquer.
- Si vous supprimez un hôte inscrit de cette façon alors que son agent tourne encore, l'agent se réinscrit tant que le jeton commun est valide. Désinstallez d'abord l'agent.

## Proxmox et conteneurs LXC

Dans l'assistant, le type *Serveur Proxmox* propose **Installer aussi dans les conteneurs LXC Debian démarrés**, activé par défaut. La commande contient alors `LXC=all`. **Aucun jeton commun** : chaque conteneur reçoit du hub **son propre jeton**. Le script root `lxc-sync.sh` dépose une demande (`/var/lib/hlm-agent/lxc/want/<CT>`) ; l'agent du Proxmox la transmet au hub, qui crée l'hôte du conteneur sous le Proxmox (ou reprend le sien) et répond avec son jeton ; le passage suivant installe l'agent avec ce jeton. Le hub n'en donne que pour un conteneur présent dans le dernier relevé du Proxmox, et jamais pour un conteneur dont l'agent est connecté. Supprimer un jeton commun n'a donc aucun effet sur les conteneurs. Le script :

1. installe l'agent sur le Proxmox lui-même ;
2. pour chaque conteneur démarré (`pct list`), vérifie qu'il s'agit d'une Debian avec systemd. Les autres conteneurs sont ignorés ;
3. copie le binaire, déjà vérifié, et les fichiers d'installation dans le conteneur avec `pct push`. **Aucun accès Internet n'est nécessaire dans les conteneurs**, seulement l'accès au hub ;
4. lance l'installation dans le conteneur, sans SMART, avec son jeton. Un conteneur sans agent attend son jeton : il est équipé au passage suivant du timer (2 à 4 minutes).
5. écrit dans la configuration du conteneur son ID (`PVE_CTID`) et le nom du Proxmox (`PVE_NODE`). Dans **Hôtes**, le Proxmox se déplie alors sur ses conteneurs, triés par ID ; sur la **Carte**, ils sont placés sous lui. Pour les conteneurs déjà équipés, relancez la même ligne sur le Proxmox : ils ne sont pas réinscrits, seule leur configuration est complétée.

Il affiche ensuite un bilan (`CT 101 (nextcloud): installed`…), puis active `hlm-agent-lxc.timer`. Toutes les 2 minutes, ce timer (script root `lxc-sync.sh`) :

- installe l'agent dans chaque **nouveau** conteneur Debian démarré qui ne l'a pas encore (un échec est retenté au bout d'une heure). Un conteneur avec l'étiquette Proxmox `no-hlm` est laissé de côté ;
- liste tous les conteneurs du cluster. Quand un conteneur est **supprimé** de Proxmox, le hub supprime son hôte (et l'inscrit au journal). Un conteneur arrêté ou migré vers un autre nœud n'est pas concerné.

**Hôte déjà installé** (comme machine virtuelle, avec Ansible, ou avant ce timer) : sur sa fiche, **Passer en serveur Proxmox**, sans rien relancer à la main. L'agent demande à l'assistant root `apt-action.sh` (action `lxc`) de relancer `install.sh` avec `LXC=all` : l'agent du Proxmox redémarre quelques secondes en gardant sa configuration et ses options (Docker, Node.js, mise à jour automatique), SMART est activé, puis l'agent s'installe dans les conteneurs Debian démarrés, sans les arrêter. Il faut `REMOTE_UPDATES` activé (par défaut). Le bouton devient **Rééquiper les conteneurs** une fois le timer actif. Le bilan s'affiche sous le bouton.

À la main : relancez une fois la ligne avec `LXC=all`, sans jeton. Une ancienne valeur `LXC_TOKEN` est ignorée ; les jetons communs « LXC de … » peuvent être supprimés. `LXC=none` arrête le timer ; une relance sans `LXC` garde le choix précédent. Les machines virtuelles (QEMU) ne sont pas concernées ; installez l'agent dans une VM comme sur n'importe quelle machine.

### Hiérarchie Proxmox → VM et conteneurs

L'agent du Proxmox relève, sans droits root, les invités branchés sur ses bridges (ports `tap<VMID>i…` et `veth<CTID>i…`) et les adresses MAC apprises sur chacun. Le hub place sous le Proxmox chaque hôte dont une adresse MAC correspond, VM comme conteneur, avec son ID. Il suffit que l'agent du Proxmox soit à jour : rien à relancer, rien à installer dans les invités. Les conteneurs installés avec `LXC=all` sont aussi rattachés par `PVE_NODE`.

Pour un autre parent (une VM sur un hyperviseur sans agent, un serveur physique…), choisissez l'**hôte parent** dans l'assistant d'ajout ou sur la fiche de l'hôte (*Hôte parent*). Un parent choisi à la main n'est jamais modifié automatiquement ; *Automatique* rend la main à la détection. La carte du homelab (gestion) reprend ces rattachements pour les éléments qui n'ont pas encore d'hôte.

Dans un conteneur non privilégié sans *nesting*, systemd ne peut pas toujours mettre en place l'isolation du service (espaces de noms). Le script le détecte et ajoute alors `/etc/systemd/system/hlm-agent.service.d/container.conf`, qui retire ces protections **dans ce conteneur uniquement**.

Désinstaller : `uninstall.sh` lancé sur le Proxmox retire aussi l'agent des conteneurs LXC démarrés qui l'ont (`LXC=none` pour les garder). Les conteneurs arrêtés ne sont pas touchés.

## Docker

Si Docker est installé au moment de l'installation de l'agent, le suivi Docker s'active tout seul. Pour le forcer : `DOCKER=true` ; pour le couper : `DOCKER=false`. Si vous installez Docker plus tard, relancez `install.sh`.

- **Toutes les minutes** : un script root (`docker-helper.sh collect`, lancé par `hlm-agent-docker.timer`, sans réseau) enregistre `docker inspect` et `docker stats`. L'agent lit ce relevé, sans jamais accéder lui-même au socket Docker, qui donne l'équivalent des droits root. Le relevé donne l'état, le healthcheck, les redémarrages, le CPU, la mémoire et le réseau de chaque conteneur.
- **Toutes les 6 heures** (et 2 minutes après le démarrage) : l'agent compare l'empreinte de chaque image locale à celle publiée sur son registre (Docker Hub, GHCR, Quay, registres auto-hébergés…). Il lit seulement l'empreinte du manifeste, sans rien télécharger et sans privilèges. Résultats possibles :
  - « Mise à jour disponible » ou « À jour » ;
  - « Image locale » pour une image construite sur la machine ;
  - « Figée » pour une image référencée par son empreinte ;
  - « Inconnu » pour un registre privé ou injoignable.
- **Mettre à jour un conteneur** depuis la page *Conteneurs* ou la fiche de l'hôte. Ce n'est possible que pour les conteneurs **Docker Compose**. Le helper root lit les labels Compose du conteneur et lance, dans son dossier, `docker compose pull <service>` puis `docker compose up -d <service>`. Les volumes sont conservés et le journal s'affiche au retour. Les conteneurs lancés avec `docker run` sont signalés, mais pas recréés : leur commande d'origine n'est pas connue. Comme pour apt, `REMOTE_UPDATES=false` retire cette possibilité.

## Pare-feu iptables

La fiche de chaque hôte connecté (monitoring) et de chaque élément relié (gestion, *Inventaire*) affiche le panneau **Pare-feu (iptables)**, avec ou sans Node.js. `IPTABLES=read` le garde en lecture seule, `IPTABLES=false` le retire. Un agent déjà installé le reçoit en relançant `install.sh`, ou avec *Type de déploiement* → *Appliquer sur l'hôte*.

- **Lecture** : règles, politiques par défaut et tables `nat`, `mangle`… en IPv4 et IPv6. Le helper root `iptables-helper.sh`, lancé par `hlm-agent-iptables.path`, répond à la demande : rien n'est stocké par le hub. Les chaînes de Docker, fail2ban, Proxmox et ufw restent affichées sans être modifiables.
- **Modification** : ajout ou suppression d'une règle de la table `filter`, politique de `INPUT`, `FORWARD` et `OUTPUT`. Le changement s'applique tout de suite, sans survivre à un redémarrage.
- **Retour arrière** : le helper sauvegarde la table avant chaque changement et arme un minuteur de 60 s. Le hub confirme dès qu'il joint de nouveau l'agent. Si le changement a coupé la connexion, la confirmation n'arrive pas et l'ancienne table revient. Une règle qui bloque seulement SSH ne coupe pas l'agent : elle se corrige depuis le panneau.
- **Enregistrer** lance `netfilter-persistent save` : `/etc/iptables/rules.v4` et `rules.v6` sont rechargés au démarrage. Les chaînes `f2b-*` sont retirées de ces fichiers : fail2ban les recrée, et les garder rendrait les bannissements du moment définitifs.
- **Installer** : sans `netfilter-persistent` ou sans `iptables`, le bouton installe `iptables` et `iptables-persistent`. Il refuse si `ufw` est présent, car apt le supprimerait.
- **Playbooks** : les chaînes `FW-*` restent gérées par le rôle `firewall`. Ce qui y est ajouté à la main disparaît au prochain passage du rôle : les règles à garder vont dans `INPUT` (le rôle les conserve et enregistre le résultat) ou dans `firewall_extra_tcp_ports`.

## Applications Node.js (playbook base-node)

Sur un hôte déployé avec le playbook `base-node`, la commande `node-app` gère les applications Node.js (pnpm, PM2, déploiement git, retour arrière). Si `/usr/local/bin/node-app` existe à l'installation de l'agent, le suivi s'active tout seul (`NODE_APPS=true|false` pour le forcer). La fiche de l'hôte affiche alors une section *Applications Node.js*, comme le tableau de bord `node-app-ui`.

- **État** : toutes les 30 secondes (5 secondes quand la fiche de l'hôte est ouverte), un helper root (`node-app-helper.sh`, lancé par `hlm-agent-node-read.path`) relève `node-app status`, les réglages de chaque app, ses 20 dernières opérations et les clés SSH. Les **variables d'environnement** (`.env`) n'en font jamais partie, et le jeton éventuel de l'URL du dépôt est masqué.
- **Actions** : *Déployer* (`deploy --force`), *Nouveaux commits* (`deploy`), *Mettre à jour* (`update`), *Redémarrer*, *Arrêter* et *Supprimer* (avec ou sans le code). Les opérations longues sont lancées par `systemd-run`, hors de l'unité du helper, comme le fait `node-app-ui`. Le journal de l'opération se suit en direct depuis l'historique. `NODE_APPS_ACTIONS=0` garde l'hôte en lecture seule.
- **Logs** de l'app (PM2) et journaux des déploiements, lus à la demande.
- **Alerte** (*Paramètres → Notifications*, activée par défaut) : app en erreur, déploiement en échec ou dernière opération annulée par un retour arrière. Chaque problème est signalé une fois.
- **Variables, nouvelle app et deploy keys**, comme dans `node-app-ui` : onglet *Variables* de l'app (lu à la demande, enregistré avec redémarrage), bouton *Nouvelle app* (dépôt git uniquement : un chemin sur le serveur est refusé ; la deploy key s'affiche pour un dépôt SSH privé, ou une clé existante s'importe), *Nouvelle clé* et *Importer une clé*. Ces secrets transitent par la connexion chiffrée de l'agent et sont remis à l'utilisateur qui les demande : le hub ne les enregistre pas. Le helper root vérifie à nouveau chaque demande, et les refuse sur un hôte en lecture seule (`NODE_APPS_ACTIONS=0`).
- **Pause** : onglet *Pause* de l'app. `node-app pause` remplace le site par une page sur le même port (code 503), sans toucher au reverse proxy. Titre, message, couleurs, police, logo, image de fond, bouton, compte à rebours, CSS, ou HTML libre, avec un aperçu rendu par l'hôte. Les déploiements continuent sans rouvrir le site, et la dernière version démarre à la reprise. Refusé en écriture sur un hôte en lecture seule (`NODE_APPS_ACTIONS=0`).
- **Git push** : une app en déploiement automatique est déployée au plus tard 2 minutes après un push (timer de l'hôte). Pour un déploiement immédiat, la fiche de l'app donne une adresse à ajouter aux webhooks du dépôt : `POST /api/hooks/node/{hôte}/{app}/{jeton}`. Le hub demande alors à l'agent de déployer les nouveaux commits, comme *Nouveaux commits*. Le corps de la requête n'est pas lu : un push sur une autre branche ne trouve rien, et toute forge convient. Seul le hub doit être joignable depuis la forge. Une adresse divulguée permet seulement de déclencher cette vérification. Sans `auto_deploy`, l'appel ne fait rien.
- Le bouton **Ouvrir Node.js UI** ouvre l'interface `node-app-ui` de l'hôte (tableau de bord système, même historique).

## Type de déploiement

Sur la fiche de l'hôte, ligne *Type de déploiement*, bouton *Changer* : Proxmox, serveur physique, machine virtuelle, conteneur LXC ou VPS. Chaque type propose ses options par défaut, comme l'assistant *Ajouter un hôte* : SMART pour un Proxmox ou un serveur physique, conteneurs LXC pour un Proxmox, mise à jour automatique de l'agent. Le type choisi est enregistré dans le hub (il l'emporte sur celui de l'installation) et repris par l'inventaire à la création de l'élément.

- *Appliquer sur l'hôte* : l'agent fait relancer `install.sh` par son helper root (`apt-action.sh reinstall`) avec ces options. Docker et les applications Node.js sont détectés à nouveau, et le hub, le jeton et la clé de `agent.env` sont conservés. Les options passent par une liste fermée, vérifiée par le hub, par l'agent et par le helper.
- La même chose se fait à la main, avec la commande affichée dans la fenêtre : `install.sh` relancé sans `TOKEN`. C'est nécessaire une fois sur un agent installé avant cette version, dont le helper ne connaît pas encore cette action.

## Options de install.sh

`install.sh` est idempotent et non interactif. Relancé sans `TOKEN`, il met seulement à jour le binaire et les unités, sans toucher à la configuration.

| Variable | Défaut | Rôle |
|---|---|---|
| `HUB_URL` | — | Adresse du hub (`https://…`, ou `http://…` avec `ALLOW_INSECURE=true`) |
| `TOKEN` | — | Jeton de la machine ou jeton commun `enr_…` |
| `KEY` | — | Clé publique du hub |
| `ALLOW_INSECURE` | `false` | Accepter un hub en HTTP (liaison non chiffrée) |
| `AUTO_UPDATE` | `true` | Mise à jour quotidienne depuis les releases GitHub |
| `SMART` | `true` | Installer smartmontools et la collecte SMART horaire |
| `REMOTE_UPDATES` | `true` | Autoriser les boutons *Vérifier* et *Mettre à jour* (paquets apt et conteneurs Docker), et *Appliquer sur l'hôte* du type de déploiement |
| `DOCKER` | `auto` | Suivi Docker : activé si `docker` est installé |
| `NODE_APPS` | `auto` | Applications Node.js : activé si `/usr/local/bin/node-app` existe (playbook base-node) |
| `NODE_APPS_ACTIONS` | `1` | `0` : applications Node.js en lecture seule (ni déploiement, ni redémarrage, ni variables, ni création, ni deploy keys) |
| `IPTABLES` | `true` | Panneau pare-feu : `read` en lecture seule, `false` désactivé. Sans cette variable, une réinstallation garde le choix en place |
| `HOST_TYPE` | détecté | Type de déploiement affiché par le hub : `proxmox`, `physical`, `vm`, `lxc` ou `vps` (`auto` : détecté). Appliqué aussi sans `TOKEN`, comme `AUTO_UPDATE` |
| `LXC` | — | `all` sur un Proxmox : installer aussi dans chaque conteneur LXC Debian démarré, puis dans les nouveaux (timer), chacun avec son propre jeton ; `none` : arrêter le timer |
| `VERSION` | dernière | Installer une release précise (`v0.1.4`) |
| `REPO` | `midnights-ra1n/homelab-management` | Dépôt hébergeant les releases (fork) |

## Désinstaller

```sh
curl -fsSL https://raw.githubusercontent.com/midnights-ra1n/homelab-management/stable/agent/uninstall.sh | sudo sh
```

Cela retire les services, le timer SMART, le binaire, la configuration, l'état et l'utilisateur `hlm-agent` ; smartmontools reste installé. Sur un Proxmox, l'agent est aussi retiré des conteneurs LXC démarrés (`LXC=none` pour l'éviter). Supprimez ensuite l'hôte dans le tableau de bord (la commande est rappelée dans la fenêtre de suppression). Avec Ansible : `hlm_agent_state: absent` ([docs/ANSIBLE.md](ANSIBLE.md#6-désinstaller)).

## Ce qui est installé

| Chemin | Propriétaire | Rôle |
|---|---|---|
| `/opt/hlm-agent/hlm-agent` | `hlm-agent`, `0755` | Binaire (modifiable par l'agent pour sa mise à jour) |
| `/etc/hlm-agent/agent.env` | `root:hlm-agent`, `0640` | Configuration |
| `/var/lib/hlm-agent/state/token` | `hlm-agent`, `0600` | Jeton personnel d'une machine inscrite avec un jeton commun |
| `/etc/systemd/system/hlm-agent.service` | `root` | Service durci : `ProtectSystem=strict`, aucune capacité, filtres d'appels système, 64 Mo de mémoire au maximum |
| `/usr/local/lib/hlm-agent/smart-collect.sh` | `root`, `0755` | Collecte SMART (lance seulement `smartctl`) |
| `/etc/systemd/system/hlm-agent-smart.{service,timer}` | `root` | Collecte SMART horaire, en root, **sans réseau** |
| `/var/lib/hlm-agent/smart/` | `root:hlm-agent`, `0750` | Résultats SMART lus par l'agent |
| `/usr/local/lib/hlm-agent/apt-action.sh` | `root`, `0755` | Actions apt demandées depuis le tableau de bord (`apt-get update`, `apt-get upgrade`) |
| `/etc/systemd/system/hlm-agent-apt.{path,service}` | `root` | Lance `apt-action.sh` quand l'agent dépose une demande |
| `/var/lib/hlm-agent/apt/` | `root:hlm-agent`, `0750` | État et journal de la dernière action apt |
| `/usr/local/lib/hlm-agent/docker-helper.sh` | `root`, `0755` | Relevé Docker et mise à jour d'un conteneur Compose |
| `/etc/systemd/system/hlm-agent-docker.{service,timer}` | `root` | Relevé Docker chaque minute, **sans réseau** |
| `/etc/systemd/system/hlm-agent-docker-update.{path,service}` | `root` | Mise à jour d'un conteneur demandée depuis le tableau de bord |
| `/var/lib/hlm-agent/docker/` | `root:hlm-agent`, `0750` | Relevé Docker et journal de la dernière mise à jour |
| `/usr/local/lib/hlm-agent/node-app-helper.sh` | `root`, `0755` | Lectures et actions `node-app` (liste fermée ; `.env`, création et deploy keys seulement à la demande du hub, hors lecture seule) |
| `/etc/systemd/system/hlm-agent-node-{read,action}.{path,service}` | `root` | Lancent le helper quand l'agent dépose une lecture ou une action |
| `/var/lib/hlm-agent/node-apps/` | `root:hlm-agent`, `0750` | Relevé des applications, réponse de la dernière lecture et journal de la dernière action |
| `/usr/local/lib/hlm-agent/iptables-helper.sh` | `root`, `0755` | Lecture et modification de la table `filter`, `netfilter-persistent save` (valeurs vérifiées une à une, aucun argument iptables brut) |
| `/etc/systemd/system/hlm-agent-iptables.{path,service}` | `root` | Lancent le helper quand l'agent dépose une demande |
| `/etc/hlm-agent/iptables` | `root`, `0644` | Choix `IPTABLES` (`true` ou `read`) lu par le helper ; absent, l'hôte est en lecture seule |
| `/var/lib/hlm-agent/iptables/` | `root:hlm-agent`, `0750` | Réponse de la dernière demande |

Root n'exécute jamais le binaire de l'agent : l'agent peut le réécrire pour se mettre à jour, ce qui ouvrirait une élévation de privilèges.

### Mises à jour système depuis le tableau de bord

L'agent n'a pas le droit d'installer de paquets. Les boutons *Vérifier* et *Mettre à jour* passent par un petit helper root :

1. l'agent écrit `refresh` ou `upgrade` dans `/var/lib/hlm-agent/state/apt-request` ;
2. l'unité `hlm-agent-apt.path` lance `apt-action.sh` en root ;
3. le script n'accepte que ces deux mots et exécute `apt-get update`, plus `apt-get upgrade` pour `upgrade` (configuration locale conservée, aucun paquet supprimé, pas de redémarrage) ;
4. l'agent lit le résultat dans `/var/lib/hlm-agent/apt/`, le renvoie au hub avec la fin du journal apt, puis relance l'analyse des paquets.

Un agent compromis peut donc au pire lancer une mise à jour depuis les dépôts configurés, jamais une commande arbitraire. Pour retirer cette possibilité : `REMOTE_UPDATES=false` à l'installation, ou `hlm_remote_updates: false` avec Ansible.

### Mémoire

L'agent lui-même occupe quelques Mo. L'unité autorise 256 Mo (`MemoryMax`), car l'analyse des mises à jour lance `apt-get`, qui charge tout le cache des paquets. Avec `OOMPolicy=continue`, si `apt-get` dépassait cette limite, seul `apt-get` serait arrêté et l'agent continuerait de tourner. Les unités installées avant la v0.1.3 limitaient le service à 64 Mo : relancez `install.sh` pour les mettre à jour. En attendant, un agent v0.1.3 détecte cette limite trop basse et saute l'analyse au lieu de redémarrer en boucle.

## Vérifier et dépanner

```sh
systemctl status hlm-agent
journalctl -u hlm-agent -n 50
/opt/hlm-agent/hlm-agent --version
```

| Message dans le journal | Cause | Solution |
|---|---|---|
| `hub rejected TOKEN (401)` | Jeton erroné, révoqué, expiré, ou régénéré | Réinstallez avec un jeton valide |
| `personal token rejected, falling back to TOKEN` | Hôte supprimé ou jeton régénéré dans le tableau de bord | Normal : l'agent se réinscrit avec le jeton commun |
| `hub signature invalid: KEY does not match this hub` | `KEY` ne correspond pas à ce hub (autre instance, ou volume `/data` recréé) | Reprenez la clé affichée par le hub |
| `HUB_URL uses plain http` | Hub en HTTP sans `ALLOW_INSECURE=true` | Ajoutez-le, ou passez le hub en HTTPS |
| `connection timed out` | Hub injoignable depuis la machine | Pare-feu, DNS, adresse du hub, port publié du conteneur |
| `updates check skipped: service memory limit 64 MiB is too low` | Unité systemd d'avant la v0.1.3 | Relancez `install.sh` (sans `TOKEN`) |
| `Failed with result 'oom-kill'` en boucle (v0.1.2) | Même cause, ancien agent | Relancez `install.sh` |

Un jeton de machine ne vaut que pour une machine. Si deux machines l'utilisent, elles se déconnectent mutuellement. Pour plusieurs machines, utilisez le jeton commun.
