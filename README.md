# Homelab Management

Application web auto-hébergée pour piloter un homelab : inventaire, IPAM, déploiements, tâches, page d'accueil,
carte interactive, gestion multi-nœuds Proxmox et monitoring centralisé (Beszel, Maintenant, PatchMon).

Design : charte **Midnights Mint** ([noe-georget.fr/graphique](https://noe-georget.fr/graphique)) — accent `#3fbfa6`,
polices Geist & Geist Mono (paquet npm `geist`), thèmes sombre / clair / auto.

## Fonctionnalités

| Module | Contenu |
| --- | --- |
| **Tableau de bord** | KPI, état Proxmox et alertes monitoring en direct, déploiements en cours, tâches à venir, capacité matérielle, occupation IPAM, journal d'activité |
| **Applications** | Raccourcis groupés, recherche (`/`, Entrée pour ouvrir), vérification de disponibilité, icônes [Dashboard Icons](https://dashboardicons.com) / [selfh.st](https://selfh.st/icons), upload d'icônes perso ou URL, réorganisation par glisser-déposer |
| **Inventaire** | Serveurs physiques, VM, CT LXC, conteneurs Docker, équipements réseau. Nom d'affichage + nom d'hôte, IP/VLAN/sous-réseau, tags, hôte parent, configuration matérielle (CPU, sockets/cœurs/threads, RAM + type, GPU, disques, interfaces, conso), OS, Proxmox, Docker, notes. Correspondance automatique avec Beszel / PatchMon |
| **Réseau (IPAM)** | VLAN, sous-réseaux (passerelle, DNS, plage DHCP), grille d'occupation cliquable, prochaine IP libre, détection de conflits |
| **Déploiements** | Suivi manuel : type, état, priorité, cible, VMID, conteneurs/apps, sous-domaines, checklist (modèles par type), notes. Vue **Cartes** ou **Liste** (état modifiable d’un clic, édition via « Modifier ») ; création de l’élément d’inventaire en un clic |
| **Tâches** | Kanban glisser-déposer (et clavier), priorités, échéances, liens vers inventaire / déploiements |
| **Carte** | Topologie React Flow : hiérarchie hôte → invités, liens physiques/logiques, filtres type / VLAN, positions sauvegardées |
| **Proxmox** | Agrégation de nœuds autonomes (sans cluster ni PDM) : ressources, invités, démarrer/arrêter/redémarrer, journal des tâches, stockages, **migration distante** (`remote-migrate`), synchronisation vers l'inventaire |
| **Monitoring** | Sondes de disponibilité intégrées (HTTP/TCP) façon status page : état global, temps de réponse (24 h / 7 j / 30 j), barres de disponibilité 90 jours, incidents (panne confirmée après 2 échecs). Plus Beszel, Maintenant et PatchMon |
| **Paramètres** | Intégrations (avec test de connexion), thème, mot de passe, export / restauration JSON |

## Mobile & PWA

- Installable (manifeste, icônes, raccourcis) : *Ajouter à l’écran d’accueil* sur iOS / Android, ou *Installer* sur desktop.
- Barre d’onglets en bas (zone du pouce), feuille « Plus » glissante, dialogues en feuilles sur mobile, tableaux en cartes.
- Service worker : ressources statiques en cache, page hors-ligne si le serveur est injoignable (aucune donnée mise en cache).
- Respecte les zones sûres (encoche, barre d’accueil) et la préférence « moins d’animations ».

> L’installation PWA exige HTTPS (ou `localhost`) : passe par ton reverse proxy avec un certificat.

## Démarrage rapide

### Docker / Podman

```bash
docker compose up -d --build
# → http://<hôte>:3000 : le premier accès propose de créer le compte administrateur
```

Les données (base SQLite, icônes téléversées, clé de chiffrement) vivent dans le volume `/data`.

### CT Proxmox depuis une image OCI (PVE 9.1+)

```bash
docker build -t homelab-management .
docker save homelab-management | gzip > homelab-management.tar.gz   # ou pousser vers un registre
```

Puis dans Proxmox : *Stockage → CT Templates → Pull from OCI registry* (ou téléverser l'archive), créer le CT
et monter un volume sur `/data`. Le port exposé est `3000`.

### Développement

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm lint && pnpm build
```

Prérequis : Node.js ≥ 22.13 (utilise le module natif `node:sqlite`, aucune dépendance native à compiler).

## Configuration

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `DATA_DIR` | `./data` (`/data` en image) | Base SQLite, icônes, clé |
| `APP_SECRET` | générée dans `DATA_DIR/secret.key` | Clé de chiffrement AES-256-GCM des secrets d'intégration |
| `COOKIE_SECURE` | `false` | Cookie de session `Secure` (derrière HTTPS) |
| `AUTH_DISABLED` | `false` | Désactive la connexion intégrée (uniquement derrière un SSO) |
| `MONITOR_DISABLED` | `false` | Désactive le moniteur de disponibilité en tâche de fond |
| `PORT` / `TZ` | `3000` / `Europe/Paris` | |

## Intégrations

- **Proxmox VE** — une intégration par nœud. Jeton API (*Datacenter → Permissions → API Tokens*) : `PVEAuditor` suffit
  en lecture, `PVEVMAdmin` pour les actions. Pour la migration distante, le jeton cible doit avoir `Sys.Incoming`.
  Désactiver la vérification TLS pour le certificat auto-signé.
- **Beszel** — URL du hub + e-mail / mot de passe d'un utilisateur (API PocketBase).
- **Maintenant** — URL ; pas d'auth native, un en-tête optionnel permet de traverser le reverse proxy.
- **PatchMon** — identifiants d'*Integration API* avec la portée `host:get` (auth Basic).

Les secrets sont chiffrés en base et ne sont jamais renvoyés au navigateur.

## Architecture

```
src/
  app/(auth)        connexion, premier démarrage
  app/(app)         pages (tableau de bord, inventaire, réseau, …)
  app/api           santé, export, icônes téléversées
  actions/          server actions (validation zod, session requise)
  lib/db            SQLite (node:sqlite) + migrations
  lib/data          accès aux données par domaine
  lib/integrations  clients Proxmox, Beszel, Maintenant, PatchMon
  components/       UI de la charte (boutons, champs, cartes, dialogues…)
  features/         composants métier par module
```

Stack : Next.js 16 (App Router, Cache Components, React Compiler), React 19, Tailwind CSS 4, zod, React Flow, lucide.
