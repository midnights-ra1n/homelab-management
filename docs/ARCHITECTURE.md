# Architecture et communications

Ce document décrit comment les pièces de Homelab Tools se parlent : le serveur et ses deux rôles, l'agent, les navigateurs, l'app native et les services extérieurs (Proxmox, Webmin, Apple). Pour l'installation, voir le [README](../README.md) ; pour l'usage de chaque rôle, le [guide du monitoring](MONITORING.md) et le [guide de la gestion](GESTION.md).

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Le serveur et ses deux rôles](#le-serveur-et-ses-deux-rôles)
3. [Flux entre les hôtes](#flux-entre-les-hôtes)
4. [Authentification](#authentification)
5. [Temps réel](#temps-réel)
6. [Données](#données)
7. [Sécurité](#sécurité)
8. [Ports et réseau](#ports-et-réseau)

## Vue d'ensemble

```
   agents (hlm-agent, Rust)              navigateurs                 app iOS / macOS
        │ WebSocket /api/agent/ws         │ session + /api/events      │ jeton + /api/v1/events
        │ signature du hub vérifiée       │                            │
        ▼                                 ▼                            ▼
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ homelab-tools, rôle MONITORING (VPS)                     hlm.db            │──▶ APNs (notifications)
  │ agents, sondes, alertes, page de statut, rapports, API v1                 │──▶ SMTP (e-mails)
  └───────────────────────────────────────────────────────────────────────────┘
        ▲ /api/v1 : compte du monitoring → jeton (chiffré côté gestion)
        │ toutes les 2 min + à la demande
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ homelab-tools, rôle GESTION (VM / CT)                    homelab.db       │──▶ Proxmox VE (REST, noVNC)
  │ inventaire, réseau, déploiements, tâches, carte, applications             │──▶ Webmin (HTTP + SSH)
  └───────────────────────────────────────────────────────────────────────────┘──▶ ping ICMP des éléments
        ▲
        │ session
   navigateurs
```

## Le serveur et ses deux rôles

Un seul binaire Go, `homelab-tools`, livré en `.deb` et en image Docker. La variable `HLT_ROLE` choisit le rôle au démarrage :

| | Monitoring | Gestion |
|---|---|---|
| Où | un VPS ou une machine toujours joignable, que les agents peuvent atteindre | une VM ou un CT du homelab |
| Base | `hlm.db` | `homelab.db` |
| Interface | supervision : hôtes, sondes, incidents, rapports… | inventaire, réseau, Proxmox… |
| API publique | `/api/v1` (apps, scripts, gestion) | aucune ; l'interface utilise `/api/mg` |
| Port par défaut | 3000 | 3000 (un autre si les deux rôles partagent un hôte) |

Les deux rôles partagent le code des comptes, des passkeys, du journal, de l'administration de la base, des mises à jour et du serveur MCP. Ils peuvent tourner sur le même hôte avec deux ports différents (`HLT_LISTEN`), mais l'usage prévu est de les séparer : la supervision doit rester joignable quand le homelab tombe.

## Flux entre les hôtes

| De → vers | Canal | Contenu | Fréquence |
|---|---|---|---|
| Agent → monitoring | WebSocket `/api/agent/ws` | infos système, mesures, mises à jour, SMART, conteneurs, résultats d'actions | mesures toutes les 30 s (réglable), le reste à chaque changement |
| Monitoring → agent | même WebSocket | demandes d'action (vérifier / appliquer les mises à jour, mettre à jour l'agent ou un conteneur), mesures en direct | à la demande |
| Monitoring → cibles des sondes | HTTP, TCP, UDP, ICMP, DNS, TLS, SNMP, Meross (LAN), TrueNAS (WebSocket) | une vérification | intervalle de chaque sonde (60 s par défaut) |
| Gestion → monitoring | HTTPS `/api/v1` | hôtes, sondes, bande passante, énergie ; mise à jour d'agent ; suppression d'hôte au décommissionnement | toutes les 2 min, plus les pages ouvertes |
| Gestion → Proxmox | HTTPS `/api2/json` (port 8006) | nœuds, invités, actions, sauvegardes, migrations ; console noVNC relayée | à l'ouverture des pages et sur action |
| Gestion → Webmin | HTTPS (interface) + SSH par clé | joignabilité, état système en lecture seule | à l'ouverture de la page |
| Gestion → éléments de l'inventaire | ICMP | joignabilité de l'adresse principale | toutes les minutes |
| Monitoring → Apple (APNs) | HTTPS/2 | notifications push | à chaque fenêtre de regroupement |
| Monitoring → SMTP | SMTP (STARTTLS / TLS) | alertes et rapports | à chaque fenêtre de regroupement, rapports planifiés |
| Les deux rôles → GitHub | HTTPS | dernière release (serveur, agent) | toutes les 6 h et à la demande |

**Les agents ne parlent qu'au monitoring.** La gestion ne contacte jamais un agent : elle lit ce que le monitoring sait, et lui demande les actions (mise à jour d'agent, suppression d'hôte).

**Proxmox reste indépendant** de l'inventaire et du monitoring : aucun lien automatique entre un invité Proxmox et un élément de l'inventaire.

## Authentification

| Qui | Auprès de | Comment |
|---|---|---|
| Navigateur | chaque rôle | identifiant + mot de passe (Argon2id) ou passkey (HTTPS) → cookie de session HttpOnly, SameSite=Strict, 7 jours. Cookies distincts par rôle |
| Agent | monitoring | jeton d'agent (propre à l'hôte) ; le hub prouve son identité en signant le *hello* (Ed25519) avec la clé que l'agent connaît (`KEY`). Un jeton d'inscription commun ne peut que créer des hôtes |
| Gestion | monitoring | compte du monitoring → `POST /api/v1/auth/login` → jeton rattaché au compte (scopes `hosts:read`, `hosts:write`, `monitors:read`, `reports:read`). Identifiants et jeton chiffrés dans la base de la gestion ; nouveau jeton automatique s'il est révoqué |
| App native | monitoring | même connexion par compte ; jeton dans le trousseau, mot de passe jamais conservé |
| Script, outil tiers | monitoring | jeton créé à la main dans *Réglages → API*, scopes choisis ; exige l'API activée |
| Gestion | Proxmox | jeton API (`PVEAPIToken`) ou compte (ticket renouvelé toutes les 90 min, jeton CSRF pour les écritures). La migration entre nœuds exige un jeton sur la cible |
| Gestion | Webmin | clé SSH générée dans la gestion, empreinte de l'hôte mémorisée à la première connexion |
| Assistant (Claude…) | chaque rôle | serveur MCP : OAuth 2.1 avec PKCE, ou jeton fixe `mcp_…` ; HTTPS uniquement |

Les jetons obtenus par connexion d'un compte fonctionnent **même avec l'API publique désactivée** : la gestion et l'app n'ont rien à ouvrir. Changer le mot de passe d'un compte révoque ses sessions web et tous ses jetons de connexion.

## Temps réel

Une seule technique pour le web et les apps : un flux **Server-Sent Events** qui annonce ce qui a changé, sans les données.

| Client | Flux | Réaction |
|---|---|---|
| Interface web du monitoring | `GET /api/events` (session) | chaque page se recharge quand un sujet qui la concerne change |
| App native au premier plan | `GET /api/v1/events` (jeton) | rechargement de `/overview` sur changement |
| App en arrière-plan, widgets | notifications APNs | l'extension de notification relit `/widgets` |

Sujets : `hosts` (état et infos d'un hôte), `monitors` (état d'une sonde), `metrics` (nouvelles mesures, à recharger au plus toutes les 30 s), `all` (modification depuis le web ou l'API). Le hub regroupe les sujets d'une même seconde et envoie un *ping* toutes les 25 s. Quand le flux est coupé, le web revient à un rafraîchissement périodique. Détails : [API, `GET /events`](API.md#get-apiv1events).

## Données

| Fichier | Rôle | Contenu |
|---|---|---|
| `hlm.db` | monitoring | comptes, hôtes, mesures, sondes et résultats, cumuls journaliers, réglages, jetons, journal |
| `homelab.db` | gestion | comptes, inventaire, réseau, déploiements, tâches, raccourcis, carte, intégrations, journal |
| `secret.key` | les deux | clé AES-256-GCM des secrets stockés (ou variable `APP_SECRET`) |
| `hub_ed25519.pem` | monitoring | clé Ed25519 qui signe le *hello* des agents (sa clé publique est le `KEY` des agents) |
| `uploads/` | gestion | icônes des raccourcis |

- SQLite en WAL, une seule connexion, `synchronous=NORMAL` : peu d'écritures disque, peu de mémoire.
- Rétention réglable (mesures, résultats de sondes, cumuls journaliers) et taille maximale de la base ; le journal garde 90 jours.
- **Sauvegardez `secret.key` avec la base** : sans elle, les secrets (intégrations, communautés SNMP, mots de passe) sont à ressaisir.
- Les deux rôles ont un export / import JSON (*Paramètres*), sans les secrets.

## Sécurité

- **Secrets chiffrés** (AES-256-GCM, format `v1.`) : identifiants des intégrations, clés SSH, mots de passe SMTP, secrets SNMP, clé Meross, jeton de la gestion auprès du monitoring. Ils ne sont jamais renvoyés au navigateur.
- **Jetons hachés** (SHA-256) : jetons d'API, d'agent, de session et MCP ne sont stockés que sous forme d'empreinte.
- **Aucun travail root dans le serveur ni l'agent.** Les mises à jour système et du serveur passent par des scripts fixes (`apt-action.sh`, `update.sh`) lancés par des unités systemd *path* ; le serveur écrit seulement une demande.
- **Sandbox** : unité systemd stricte (`ProtectSystem=strict`, aucune capacité), image Docker distroless non-root en lecture seule.
- **Origine vérifiée** sur toutes les écritures web (`Origin`, `Sec-Fetch-Site`) ; `/api/v1` n'accepte que des jetons, donc pas de CSRF.
- **Limites** : 10 tentatives de connexion par minute et par IP, 600 requêtes par minute et par jeton d'API, 200 flux en direct simultanés.
- **Reverse proxy** : les en-têtes `X-Forwarded-*` ne sont crus que depuis `HLT_TRUSTED_PROXIES`. Passkeys et MCP exigent HTTPS.

## Ports et réseau

| Port | Sens | Usage |
|---|---|---|
| 3000/tcp | entrant | interface, API, agents, flux en direct (`HLT_LISTEN`) |
| 8080/tcp | entrant, facultatif | ancien port, redirigé vers 3000 après mise à jour (`HLT_LEGACY_LISTEN`) |
| 443/tcp | sortant | GitHub (mises à jour), APNs, Proxmox / TrueNAS / Webmin en HTTPS |
| 8006/tcp | sortant (gestion) | API Proxmox VE |
| 22/tcp | sortant (gestion) | SSH vers Webmin |
| 161/udp | sortant (monitoring) | sondes SNMP |
| ICMP | sortant | sondes ping (monitoring), joignabilité de l'inventaire (gestion) |
| 25, 465, 587/tcp | sortant (monitoring) | SMTP |

Les agents ont seulement besoin de joindre le monitoring en HTTPS : ils ouvrent la connexion, aucun port entrant n'est nécessaire sur les machines supervisées.
