# Applications natives : iOS, iPadOS et macOS

Ce guide décrit ce qu'une app native attend du hub Midnights Monitoring et comment s'en servir : préparer le serveur, se connecter, charger les écrans, rester à jour en temps réel, recevoir les notifications et alimenter les widgets. Il ne contient pas de code : l'app vit dans son propre dépôt. Chaque route citée est détaillée dans la [référence de l'API](API.md).

## Sommaire

1. [Vue d'ensemble](#vue-densemble)
2. [Préparer le serveur](#préparer-le-serveur)
3. [Préparer le compte Apple Developer](#préparer-le-compte-apple-developer)
4. [Connexion](#connexion)
5. [Écrans et routes](#écrans-et-routes)
6. [Gestion : inventaire, stock et notifications](#gestion--inventaire-stock-et-notifications)
7. [Temps réel](#temps-réel)
8. [Notifications push](#notifications-push)
9. [Widgets et actions rapides](#widgets-et-actions-rapides)
10. [Préférences synchronisées](#préférences-synchronisées)
11. [Format des réponses](#format-des-réponses)
12. [Sécurité](#sécurité)
13. [Dépannage](#dépannage)
14. [Liste de contrôle avant publication](#liste-de-contrôle-avant-publication)

## Vue d'ensemble

```
            ┌──────────── iPhone / iPad / Mac ─────────────┐
            │  App ───────────┐                            │
            │  Widgets ───────┼── jeton (trousseau partagé) ┼── HTTPS ──▶  Hub Midnights Monitoring
            │  Extension de   │   cache (App Group)        │             /api/v1/…
            │  notification ──┘                            │                 │
            └──────────────────────────▲───────────────────┘                 │ changements d'état
                                       │ notification                        ▼
                                       └─────────────── APNs (Apple) ◀── clé .p8 du hub
```

- **L'état des hôtes et des sondes vient du monitoring**, par l'API v1 et un jeton. La gestion (Midnights Management) n'a pas d'API publique ni de jetons : pour l'inventaire, le stock matériel, les tâches et les rappels, l'app utilise les routes `/api/mg` de l'interface web avec une session (voir [Gestion](#gestion--inventaire-stock-et-notifications)).
- **Connexion par compte.** L'utilisateur saisit l'adresse du hub, son identifiant et son mot de passe ; l'app les échange contre un jeton (`POST /auth/login`) et ne garde que le jeton. L'API publique du hub peut rester désactivée.
- **Au premier plan**, l'app écoute le flux d'événements (`GET /events`) et ne recharge que ce qui a changé.
- **En arrière-plan**, c'est le hub qui réveille l'appareil par une notification push ; l'extension de notification met les widgets à jour au passage.

## Préparer le serveur

### HTTPS

L'app doit joindre le hub en **HTTPS** avec un certificat valide (reverse proxy, voir le [README](../README.md#https-derrière-un-reverse-proxy)). Le jeton circule dans chaque requête, et App Transport Security refuse le HTTP par défaut.

Pour un hub joint uniquement sur le réseau local en HTTP : `NSAllowsLocalNetworking` autorise les noms sans domaine et en `.local` ; pour un autre nom, une exception `NSExceptionDomains` limitée à ce nom. Jamais `NSAllowsArbitraryLoads`. Le jeton circulant alors en clair, réservez ce cas à un réseau de confiance. Ajoutez `NSLocalNetworkUsageDescription` dès que le hub est joint par une adresse du réseau local.

Rien n'est à activer dans *Réglages → API* : les jetons obtenus par connexion fonctionnent avec l'API désactivée.

### Notifications (APNs)

Le hub envoie lui-même les notifications à Apple, avec une clé `.p8` du compte développeur. Quatre variables d'environnement du rôle monitoring :

| Variable | Valeur |
|---|---|
| `HLT_APNS_KEY` | chemin du fichier `.p8` |
| `HLT_APNS_KEY_ID` | identifiant de la clé (10 caractères, visible dans le nom `AuthKey_XXXXXXXXXX.p8`) |
| `HLT_APNS_TEAM_ID` | identifiant de l'équipe (*Membership details* du compte développeur) |
| `HLT_APNS_TOPIC` | bundle id de l'app, ex. `fr.midnights.monitoring` |

**Docker Compose :**

```yaml
services:
  monitoring:
    environment:
      HLT_APNS_KEY: /run/secrets/apns.p8
      HLT_APNS_KEY_ID: "ABC123DEFG"
      HLT_APNS_TEAM_ID: "TEAM123456"
      HLT_APNS_TOPIC: "fr.midnights.monitoring"
    volumes:
      - ./AuthKey_ABC123DEFG.p8:/run/secrets/apns.p8:ro
```

L'image tourne avec l'utilisateur `nonroot` (uid 65532) : le fichier doit lui être lisible (`chmod 444` sur l'hôte, ou `chown 65532`).

**Paquet Debian :** décommentez les lignes `HLT_APNS_*` de `/etc/homelab-tools/monitoring.env`, puis :

```sh
sudo install -o homelab-tools -g homelab-tools -m 400 AuthKey_ABC123DEFG.p8 /etc/homelab-tools/apns.p8
sudo systemctl restart homelab-tools@monitoring
```

Après redémarrage, *Réglages → API → Appareils* n'affiche plus « APNs non configuré ». Une clé illisible ou invalide est signalée dans le journal du serveur (`APNs key: …`) ; le reste du hub fonctionne normalement.

> Un seul `HLT_APNS_TOPIC` est pris en charge : l'app iOS et l'app macOS doivent partager le **même bundle id** (une cible multiplateforme, pas Mac Catalyst, qui préfixe le bundle id par `maccatalyst.`).

## Préparer le compte Apple Developer

1. **Identifiant d'app** (*Certificates, Identifiers & Profiles → Identifiers*) avec les capacités *Push Notifications* et *App Groups*, plus un identifiant par extension (widgets, notification).
2. **App Group** commun à l'app et à ses extensions : l'adresse du hub et le cache des widgets y sont partagés.
3. **Keychain Sharing** commun : le jeton doit être lisible par l'app, l'extension de widgets et l'extension de notification.
4. **Clé APNs** (*Keys → +*) : *Apple Push Notifications service (APNs)*, environnement *Sandbox & Production*. Le `.p8` ne se télécharge **qu'une fois** ; notez le *Key ID*.

| Capacité | App | Widgets | Notification |
|---|---|---|---|
| Push Notifications | ✓ | | |
| Background Modes → *Remote notifications* (iOS) | ✓ | | |
| App Groups | ✓ | ✓ | ✓ |
| Keychain Sharing | ✓ | ✓ | ✓ |
| Time Sensitive Notifications | ✓ | | |
| App Sandbox → *Outgoing Connections* (macOS) | ✓ | ✓ | ✓ |

*Time Sensitive Notifications* permet aux pannes (`interruption-level: time-sensitive`) de passer les modes Concentration autorisés par l'utilisateur.

## Connexion

1. L'utilisateur saisit l'adresse du hub (`https://monitoring.example.fr`, sans `/api/v1`), son identifiant et son mot de passe du monitoring.
2. L'app appelle `POST /api/v1/auth/login` avec `username`, `password` et `name` : le nom de l'appareil (1 à 64 caractères), qui apparaîtra dans *Réglages → API*.
3. Le hub répond `201` avec `token` (`hlm_…`). L'app range le jeton dans le **trousseau** et l'adresse dans l'App Group. **Le mot de passe n'est jamais enregistré.**
4. L'app inscrit l'appareil aux notifications (voir plus bas).

| Réponse de `/auth/login` | Message à afficher |
|---|---|
| `201` | connexion réussie |
| `401` | identifiant ou mot de passe incorrect |
| `429` | trop de tentatives, réessayer dans une minute |
| `404` | adresse qui n'est pas un hub Midnights Monitoring, ou hub trop ancien |
| erreur réseau | hub injoignable (adresse, VPN, certificat) |

Le jeton obtenu a tous les scopes. Pour une app volontairement limitée (lecture seule), envoyez `scopes` (ex. `["status:read", "hosts:read", "monitors:read", "push:write"]`) et masquez les fonctions qui répondent ensuite `403`.

**Plus tard**, un `401` sur n'importe quelle route signifie que le jeton a été révoqué dans *Réglages → API* ou que le mot de passe du compte a changé : affichez de nouveau l'écran de connexion.

**Déconnexion** : `POST /api/v1/auth/logout` révoque le jeton et désinscrit l'appareil des notifications. Effacez ensuite le trousseau et l'App Group.

## Écrans et routes

Chaque requête porte `Authorization: Bearer hlm_…` et `Accept: application/json`.

| Écran | Route | Remarques |
|---|---|---|
| Accueil | `GET /overview` | résumé, problèmes, consommation, hôtes et sondes **en un appel cohérent** |
| Détail d'un hôte | `GET /hosts/{id}` | inclut la liste des paquets à mettre à jour |
| Graphiques d'un hôte | `GET /hosts/{id}/metrics?range=24h` | `1h`, `6h`, `24h`, `7d`, `30d`, `90d` |
| Détail d'une sonde | `GET /monitors/{id}`, `GET /monitors/{id}/results?range=24h` | |
| Bande passante | `GET /bandwidth?range=24h`, `GET /bandwidth/live` | `/live` seulement quand l'écran est affiché |
| Mises à jour, disques, conteneurs | `GET /updates`, `GET /disks`, `GET /containers` | |
| Énergie, rapport | `GET /reports/energy?days=30`, `GET /reports/monthly?month=2026-09` | |
| Maintenance | `PUT /hosts/{id}/maintenance`, `PUT /monitors/{id}/maintenance` | corps `{"maintenance": true}` |
| Mise à jour de l'agent | `POST /hosts/{id}/agent-update` | l'hôte renvoyé a `action.state = pending` ; suivre par le flux `hosts` |
| Widgets, extension de notification | `GET /widgets` | le plus léger |

`/overview` remplace l'enchaînement `/status` + `/hosts` + `/monitors` : les comptes, les problèmes et les listes y sont lus ensemble, donc toujours d'accord entre eux. Les écrans de détail réutilisent l'hôte ou la sonde déjà chargés par `/overview` et ne rechargent leur route qu'à l'ouverture et sur un événement.

## Gestion : inventaire, stock et notifications

La gestion n'a pas d'API v1 : l'app appelle les mêmes routes que l'interface web, sous `/api/mg`, avec un cookie de session. Ces routes peuvent évoluer avec l'interface ; décodez-les de façon tolérante (champ absent ou inconnu ignoré).

### Session

1. `POST {gestion}/api/auth/login` avec `{"username": "…", "password": "…"}` en JSON. Réponse `200 {"ok": true}` et cookie `hlt_mg_session` (HttpOnly, valable 7 jours). `401` : identifiants incorrects ; `429` : trop de tentatives.
2. Laissez `URLSession` garder le cookie (`HTTPCookieStorage`) et renvoyez-le à chaque requête.
3. Un `401` plus tard signifie que la session a expiré ou a été fermée : rouvrez-la avec les identifiants du trousseau, puis rejouez la requête une fois. La gestion n'ayant pas de jetons, l'app doit garder l'identifiant et le mot de passe dans le trousseau (`AfterFirstUnlockThisDeviceOnly`), jamais ailleurs.
4. `POST /api/auth/logout` ferme la session.

Les écritures n'ont pas besoin d'en-tête `Origin` : un client natif n'en envoie pas, et le serveur ne refuse que les requêtes de navigateur venues d'un autre site.

**Deux formats d'écriture :**

| Format | Routes | Réponse |
|---|---|---|
| Formulaire (`application/x-www-form-urlencoded` ou `multipart/form-data`) | création et modification (`POST /api/mg/assets`, `POST /api/mg/hardware/{id}`…) | **toujours `200`**, avec un *FormState* : `{"ok": true, "message": "…"}` ou `{"message": "Certains champs sont invalides.", "errors": {"name": "Le nom est requis"}}` |
| JSON | actions (`…/status`, `…/install`, rappels) | `204` ou `200` + JSON ; erreur `4xx` avec `{"error": "…"}` |

Pour un formulaire, testez `ok` et affichez `errors` champ par champ : un `200` ne veut pas dire que l'écriture a eu lieu.

### Inventaire

| Écran | Route | Remarques |
|---|---|---|
| Liste | `GET /api/mg/assets` | filtres facultatifs : `kind`, `status`, `q` (nom, hostname, IP, MAC, n° de série, tag…), `tag`, `vlan` (numéro), `host` (id du parent) |
| Compteurs, capacité | `GET /api/mg/assets/meta` | `counts` (par type et état), `tags`, `hosts`, `hardware` (cœurs, threads, RAM des serveurs physiques), `storage` |
| Listes de choix | `GET /api/mg/assets/options?kinds=physical,vm` | `id`, `display_name`, `kind`, `hostname`, `subnet_id` |
| Fiche | `GET /api/mg/assets/{id}` | `asset`, `children`, `ancestors`, `ips`, `activity`, `domains`, `tunnels`, `rules`, `shortcuts`, `hardware` |
| Changer l'état | `POST /api/mg/assets/{id}/status` | JSON `{"status": "maintenance"}` → `204` |
| Supprimer | `DELETE /api/mg/assets/{id}` | `204` |

- `kind` : `physical`, `vm`, `lxc`, `docker`, `network`, `other`. `status` : `online`, `offline`, `maintenance`, `planned`, `decommissioned`.
- Champs principaux d'un élément : `id`, `kind`, `display_name`, `hostname`, `status`, `role`, `description`, `tags` (liste), `parent_id`, `parent_name`, `os`, `os_version`, `location`, `manufacturer`, `model`, `serial_number`, `cpu_model`, `cpu_cores`, `cpu_threads`, `ram_gb`, `disks` (liste `name`, `type`, `capacity_gb`, `usage`), `nics` (liste `name`, `mac`, `speed`), `primary_ip`, `vlan_number`, `vlan_name`, `subnet_cidr`, `children_count`, `notes`, `created_at`, `updated_at`.
- Dates de la gestion : texte `AAAA-MM-JJ HH:MM:SS` en UTC (pas de secondes Unix, contrairement au monitoring).
- `hardware` (fiche) : les machines du stock liées à l'élément, puis les composants installés dedans (même format que `GET /api/mg/hardware`). Liste vide si aucune machine n'est liée.

### Stock matériel

| Action | Route | Corps | Réponse |
|---|---|---|---|
| Liste | `GET /api/mg/hardware` | | liste triée par nom |
| Ajouter | `POST /api/mg/hardware` | formulaire | FormState |
| Modifier | `POST /api/mg/hardware/{id}` | formulaire (tous les champs) | FormState |
| Installer / retirer | `POST /api/mg/hardware/{id}/install` | JSON `{"parent_id": 12}` ou `{"parent_id": null}` | `204` ; `400` avec message |
| Dupliquer | `POST /api/mg/hardware/{id}/duplicate` | | `204` |
| Supprimer | `DELETE /api/mg/hardware/{id}` | | `204` |

Champs d'un matériel :

| Champ | Valeurs |
|---|---|
| `name` | requis, 200 caractères |
| `category` | `server`, `pc` (les **machines**), `cpu`, `ram`, `disk`, `motherboard`, `gpu`, `psu`, `nic`, `case`, `cooling`, `other` |
| `status` | `in_use`, `stock`, `ordered`, `repair`, `faulty`, `retired` |
| `quantity` | pièces identiques sur la ligne, 1 par défaut |
| `brand`, `model`, `serial_number`, `specs`, `location`, `vendor`, `notes` | texte |
| `capacity_gb` | capacité **d'une** pièce (RAM, disque) ; total = `capacity_gb × quantity` |
| `purchase_price` | prix **unitaire** en euros |
| `purchase_date`, `warranty_until` | `AAAA-MM-JJ` |
| `tags` | formulaire : texte séparé par des virgules ; réponse : liste |
| `parent_id`, `parent_name` | machine dans laquelle le composant est installé |
| `asset_id`, `asset_name` | machines seulement : élément de l'inventaire lié |
| `components` | lecture seule : nombre de lignes installées dans cette machine |

Règles appliquées par le serveur (l'app n'a pas à les refaire, mais peut éviter de proposer l'impossible) :

- Un composant ne s'installe que dans un serveur ou un PC ; une machine ne s'installe nulle part.
- Un composant installé passe `in_use`, sauf s'il est `repair`, `faulty` ou `retired`. Retiré (`parent_id: null`), il revient en `stock`.
- Installer depuis un lot (`quantity` > 1, non installé) en sort **une** pièce : une nouvelle ligne est créée dans la machine et le lot perd une unité.
- Une machine qui contient des composants ne peut pas changer pour une catégorie de composant ; supprimée, ses composants reviennent en stock.

### Menu de notifications

Le web affiche un menu à trois onglets, dans la barre latérale et en bouton rond sur mobile. Pour le reproduire :

| Onglet | Source | Contenu |
|---|---|---|
| Alertes | gestion : `GET /api/mg/monitoring` ; monitoring : `GET /api/v1/overview` | ce qui ne va pas, du plus grave au moins grave |
| Mises à jour | `hosts[].updates` de la même réponse | hôtes avec des paquets en attente ou un redémarrage requis |
| Rappels | `GET /api/reminders` | rappels programmés ; ceux dont la date est atteinte sont « dus » |

**Pastille** : nombre d'alertes + nombre d'hôtes à mettre à jour + nombre de rappels dus. Rouge s'il y a une alerte critique, jaune s'il y a une alerte, un correctif de sécurité en attente ou un rappel en retard, couleur d'accent sinon.

**Alertes depuis la gestion.** `GET /api/mg/monitoring` renvoie une liste de sources, une par intégration monitoring : `{id, name, url, ok, error?, data: {hosts, monitors, bandwidth}}`. Le web en tire, dans cet ordre :

| Cas | Gravité |
|---|---|
| hôte `major_outage` (hors ligne) | critique |
| sonde active `minor_outage` ou `major_outage` | critique |
| source `ok: false` (hub injoignable, clé refusée) : afficher `error` | critique |
| hôte à plus de 85 % de CPU, 90 % de RAM ou 90 % de disque (`latest`) | avertissement |
| certificat d'une sonde (`cert_expires_at`, secondes) qui expire dans moins de 21 jours | avertissement |
| hôte avec `updates.reboot_required` | avertissement |

Depuis le monitoring seul, `GET /api/v1/overview` donne déjà les problèmes triés.

**Mises à jour.** Chaque hôte porte `updates: {pending, security, reboot_required}` (ou `null` si l'agent n'a encore rien remonté). Le web liste les hôtes où `pending > 0` ou `reboot_required`, triés par correctifs de sécurité, puis redémarrage, puis nombre de paquets ; le détail des paquets est dans `GET /api/v1/hosts/{id}` du monitoring.

**Rappels de mise à jour.** Ils existent sur les deux serveurs (chacun garde les siens). Avec la session web, ils sont sous `/api/reminders` ; sur le monitoring, les mêmes routes existent sous `/api/v1/reminders` pour un jeton (scopes `reminders:read` et `reminders:write`, inclus dans le jeton de connexion) :

| Action | Route | Corps | Réponse |
|---|---|---|---|
| Liste | `GET /api/reminders` | | `{"today": "2026-10-20", "reminders": [{"id": 1, "host": "nas", "host_ref": "h3", "due_date": "2026-10-18", "repeat_days": 30, "note": "noyau", "due": true}]}` |
| Ajouter | `POST /api/reminders` | `{"host": "nas", "host_ref": "h3", "due_date": "2026-10-27", "repeat_days": 0, "note": ""}` | `201 {"id": 2}` |
| Modifier | `PUT /api/reminders/{id}` | même corps | `204` |
| Fait | `POST /api/reminders/{id}/done` | | `200 {"next_due": "2026-11-19"}` ; `null` pour un rappel unique, alors supprimé |
| Supprimer | `DELETE /api/reminders/{id}` | | `204` |

- `host_ref` (facultatif) lie le rappel à l'hôte : `h{id}` sur le monitoring, `{id de la source}:{id de l'hôte}` sur la gestion. Affichez le nom actuel de l'hôte qui porte cette référence, et `host` (le nom enregistré) seulement si aucun ne correspond : un hôte renommé garde ainsi ses rappels.
- `repeat_days` : 0 (une fois) à 366. « Fait » reprogramme le rappel à aujourd'hui + `repeat_days`, dans le fuseau du serveur.
- `due` et `today` sont calculés par le serveur dans son fuseau horaire : utilisez-les plutôt que la date de l'appareil.
- Erreurs `400` : `Choisissez un hôte`, `Date invalide`, `La répétition va de 0 à 366 jours`, `500 caractères maximum pour la note`.
- **Notification** : sur le monitoring, un rappel arrivé à échéance part une fois par les canaux d'alerte (push et e-mail), comme un événement `{"kind": "Rappel", "name": "nas", "message": "Mise à jour prévue le 2026-10-27 · noyau"}`. Les rappels de la gestion n'envoient rien : pour eux, l'app peut programmer une notification locale (`UNCalendarNotificationTrigger`) à la date `due_date`.

**Rafraîchissement.** Le web relit les trois sources toutes les 30 s quand l'onglet est visible. L'app peut relire au retour au premier plan et sur les événements `hosts` du flux du monitoring.

## Temps réel

L'app ne recharge plus ses écrans à intervalle fixe. Elle garde ouverte, au premier plan, une connexion au flux d'événements du hub, et ne recharge que lorsqu'un changement est annoncé. Le web fait exactement la même chose (`/api/events`).

| Situation | Mécanisme | Appels réseau |
|---|---|---|
| App au premier plan | flux `GET /events` ouvert ; rechargement de `/overview` sur changement | une connexion ; aucun appel tant que rien ne change |
| App en arrière-plan | notification push ; l'extension relit `/widgets` et redessine les widgets | aucun : le hub réveille l'appareil |
| Widgets | timeline WidgetKit (15 min demandées) + extension de notification | `/widgets` |

iOS ferme toute connexion d'une app suspendue : ni flux ni WebSocket ne peuvent rester ouverts en arrière-plan. Le temps réel hors premier plan passe donc par APNs. Les notifications silencieuses (`content-available`) ne sont pas utilisées : iOS les limite à quelques-unes par heure sans garantir leur livraison.

### Le flux

`GET /api/v1/events` (scope `status:read`) est un flux [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) : une réponse HTTP qui ne se termine pas, faite de lignes de texte.

```text
retry: 5000
event: ready
data: {}

event: changed
data: {"topics":["hosts","metrics"]}

: ping
```

| Événement / sujet | Signification | Réaction conseillée |
|---|---|---|
| `ready` | connexion (ou reconnexion) établie | tout recharger : des changements ont pu être manqués |
| `hosts` | état d'un hôte, infos de l'agent, mises à jour, disques, conteneurs, action en cours | recharger tout de suite |
| `monitors` | état d'une sonde | recharger tout de suite |
| `metrics` | nouvelles mesures (agent, résultat de sonde) ; fréquent | recharger au plus toutes les 30 s |
| `all` | modification faite depuis le web ou l'API | tout recharger |

- Les sujets d'une même seconde arrivent ensemble, dans une seule ligne `data:`.
- Une ligne `: ping` arrive toutes les 25 s : un délai d'inactivité de 60 s côté client détecte une connexion morte.
- Le flux ne porte aucune donnée, seulement des noms de sujets ; les données se lisent sur les routes habituelles.
- Une seule connexion pour toute l'app : les écrans s'abonnent au même flux, ils n'en ouvrent pas chacun un.

### Cycle de vie

1. Quand l'app passe au premier plan : ouvrir le flux. L'événement `ready` déclenche le premier chargement.
2. Sur `changed` : recharger selon le tableau ci-dessus. Les agents envoient leurs mesures toutes les 30 s par défaut ; recharger plus souvent sur `metrics` n'apporte rien.
3. Si la connexion se coupe (réseau, redémarrage du hub) : se reconnecter après 1, 2, 4… jusqu'à 60 s ; l'événement `ready` de la reconnexion recharge tout.
4. `401` : jeton révoqué, retour à l'écran de connexion. `404` : hub trop ancien pour le flux ; recharger alors toutes les 30 s.
5. Quand l'app quitte le premier plan : fermer le flux.

## Notifications push

### Inscription

À chaque lancement, après l'autorisation des notifications : `POST /api/v1/devices` (scope `push:write`) avec le `deviceToken` APNs en hexadécimal, le nom de l'appareil et `sandbox` (`true` pour un build lancé depuis Xcode, `false` pour TestFlight et l'App Store). L'appel est idempotent. L'appareil apparaît dans *Réglages → API → Appareils* ; révoquer son jeton le désinscrit.

### Ce que le hub envoie

Une notification par fenêtre de regroupement (60 s par défaut, *Réglages → Notifications par e-mail → Fenêtre de regroupement*, qui s'applique aussi au push même si l'e-mail est désactivé), avec tous les changements de la fenêtre :

```json
{
  "aps": {
    "alert": { "title": "2 service(s) en panne", "body": "nas : Performances dégradées · Agent hors ligne, l'hôte répond toujours au ping\nNextcloud : Panne majeure · Requête échouée : …" },
    "sound": "default",
    "thread-id": "midnights-monitoring",
    "mutable-content": 1,
    "interruption-level": "time-sensitive"
  },
  "events": [
    { "kind": "Hôte", "name": "nas", "from": "operational", "to": "degraded", "message": "Agent hors ligne, l'hôte répond toujours au ping", "at": 1792046280 },
    { "kind": "Sonde", "name": "Nextcloud", "from": "operational", "to": "major_outage", "message": "Requête échouée : …", "at": 1792046291 }
  ]
}
```

- Le titre et le texte sont prêts à afficher : aucune extension n'est nécessaire pour une notification lisible.
- `interruption-level` vaut `time-sensitive` quand un élément passe en panne partielle ou majeure, `active` sinon.
- `mutable-content: 1` réveille l'**extension de notification** (environ 30 s) : elle relit `/widgets`, met à jour le cache partagé et demande à WidgetKit de redessiner.
- Les événements ne portent pas d'identifiant : retrouvez l'hôte ou la sonde par `name`.
- Toutes les notifications vont à tous les appareils inscrits. Les interrupteurs de *Réglages → Notifications par e-mail* (mises à jour de sécurité, redémarrage requis, images Docker, niveau SMART, espace disque) s'appliquent aussi au push. Les rappels de mise à jour arrivés à échéance partent toujours (`kind` = `Rappel`).

### Tester

1. Lancez l'app sur un appareil réel et acceptez les notifications.
2. *Réglages → API → Appareils* : l'appareil apparaît, avec l'étiquette « développement » pour un build Xcode.
3. *Envoyer un test* : une notification « Notification de test » arrive. En cas d'échec, la colonne *Dernier envoi* affiche l'erreur d'Apple.
4. Pour un vrai changement d'état, arrêtez l'agent d'un hôte (`sudo systemctl stop hlm-agent`) : après environ 3 intervalles d'agent puis la fenêtre de regroupement, la notification arrive.

## Widgets et actions rapides

- **Une seule route** : `GET /widgets` donne l'état global, les comptes par état, au plus 10 problèmes et la consommation des prises. N'enchaînez pas d'autres appels dans un widget.
- **Cache** : gardez la dernière réponse dans l'App Group et affichez-la quand le hub est injoignable, avec un indicateur discret plutôt qu'une erreur.
- **Budget** : WidgetKit limite les rafraîchissements (quelques dizaines par jour) ; 15 min est une demande, pas une garantie. L'extension de notification et le retour de l'app au premier plan gardent les widgets à jour entre deux créneaux.
- **Écran verrouillé** : le jeton doit être lisible après le premier déverrouillage (`AfterFirstUnlockThisDeviceOnly`) pour que les widgets fonctionnent.
- **Boutons de widget et Raccourcis** (App Intents) : la maintenance d'un hôte ou d'une sonde passe par `PUT /hosts/{id}/maintenance` ou `PUT /monitors/{id}/maintenance` (scope `maintenance:write`). Après l'action, la timeline relit `/widgets`, où l'élément sort des problèmes.

## Préférences synchronisées

`GET /api/v1/preferences` et `PUT /api/v1/preferences` lisent et modifient un objet JSON partagé avec l'interface web. `PUT` fusionne par clé de premier niveau ; `null` supprime une clé ; la dernière écriture d'une clé l'emporte. 16 Kio au plus.

| Clé | Partagée avec le web | Valeurs |
|---|---|---|
| `theme` | oui | `auto`, `light`, `dark` |
| `monitors_view` | oui | `cards`, `table` |
| `ios.*` (ex. `ios.home.sections`) | non | libres, propres à l'app |

Préfixez les clés propres à l'app : le web les ignore, sans risque de collision avec une future clé. Relisez les préférences au lancement et au retour au premier plan ; gardez une copie locale pour le mode hors ligne.

## Format des réponses

- Noms de champs en `snake_case`. Ne convertissez pas automatiquement les clés en camelCase : la conversion toucherait aussi les clés de dictionnaires (`by_status.major_outage`, clés des préférences). Déclarez les correspondances champ par champ.
- Horodatages en **secondes Unix**, sauf les champs signalés en millisecondes dans la [référence](API.md#conventions).
- États : `operational`, `degraded`, `minor_outage`, `major_outage`, `maintenance`, `unknown` ([valeurs d'état](API.md#valeurs-détat)). Prévoyez une valeur inconnue : de nouveaux états ou champs peuvent être ajoutés sans changer de version.
- Erreurs : `{"error": "…"}`, message en français prêt à afficher. `429` porte `Retry-After` ; ne réessayez que les `429`, `502` et erreurs réseau.

## Sécurité

- **Un jeton par appareil**, obtenu à la connexion sous le nom de l'appareil. Le révoquer coupe l'accès **et** désinscrit l'appareil des notifications ; changer le mot de passe du compte déconnecte tous les appareils.
- **Le mot de passe du monitoring ne reste pas sur l'appareil** : il ne sert qu'à `POST /auth/login`. Celui de la gestion, qui n'a pas de jetons, est gardé dans le trousseau pour rouvrir la session.
- **Trousseau uniquement** pour le jeton, en `AfterFirstUnlockThisDeviceOnly` (pas de sauvegarde iCloud, pas de copie sur un autre appareil) : jamais dans `UserDefaults`, les fichiers de l'App Group, les journaux ou les rapports de plantage.
- **HTTPS avec un certificat valide.** Ne désactivez pas la validation TLS ; préférez un certificat Let's Encrypt sur le reverse proxy.
- **Pas de CORS** : une app native n'est pas un navigateur ; laissez *Origines autorisées* vide pour elle.
- **Écran verrouillé** : le texte des notifications peut contenir des noms d'hôtes et des messages d'erreur ; l'utilisateur peut masquer les aperçus dans les réglages du système.
- **Clé APNs** : elle permet d'envoyer des notifications à toutes vos apps. Lisible seulement par l'utilisateur du serveur, hors de tout dépôt Git ; révoquez-la dans le compte développeur en cas de fuite.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « APNs non configuré » dans *Réglages → API* | variable `HLT_APNS_*` manquante ou clé illisible | vérifier les quatre variables et le journal du serveur (`APNs key: …`), redémarrer |
| *Dernier envoi* : `APNs 403 InvalidProviderToken` | Key ID ou Team ID incorrect | corriger `HLT_APNS_KEY_ID` / `HLT_APNS_TEAM_ID` |
| `APNs 400 BadDeviceToken` (appareil retiré) | environnement inversé : build Xcode inscrit en production, ou TestFlight en `sandbox` | corriger la valeur `sandbox` envoyée ; l'app se réinscrit au lancement suivant |
| `APNs 400 DeviceTokenNotForTopic` | `HLT_APNS_TOPIC` différent du bundle id | aligner les deux |
| `APNs 400 TopicDisallowed` | clé d'un autre compte, ou App ID sans *Push Notifications* | recréer la clé dans le bon compte |
| `APNs 410 Unregistered` (appareil retiré) | app désinstallée ou notifications désactivées | normal ; l'appareil se réinscrit s'il les réactive |
| Aucune notification, aucune erreur | aucun changement d'état, ou appareil inscrit avec un jeton révoqué depuis | *Envoyer un test* ; vérifier la liste des appareils |
| Notification de panne en retard | regroupement (60 s) + seuil d'échecs des sondes + 3 intervalles d'agent pour un hôte | réduire la fenêtre de regroupement ou l'intervalle des sondes |
| L'écran ne se met plus à jour tout seul | flux `/events` coupé ou retardé par le proxy | `curl -N -H "Authorization: Bearer …" https://…/api/v1/events` doit montrer un `: ping` toutes les 25 s ; nginx : `proxy_buffering off` |
| `401` partout | jeton révoqué, ou mot de passe du compte changé | afficher l'écran de connexion |
| `404` sur `/auth/login` | adresse de la gestion au lieu du monitoring, ou monitoring trop ancien | utiliser l'adresse du monitoring ; le mettre à jour |
| Formulaire de la gestion sans effet, réponse `200` | *FormState* avec `ok` absent et `errors` | afficher `errors` champ par champ |
| `401` sur `/api/mg/…` ou `/api/reminders` (gestion) | session de la gestion expirée (7 jours) | rouvrir la session avec `POST /api/auth/login` et rejouer la requête |
| `403` sur une route | connexion avec une liste `scopes` réduite | se reconnecter sans `scopes`, ou masquer la fonction |
| Widget vide ou « hub non configuré » | jeton illisible par l'extension | même groupe Keychain Sharing et même App Group sur les trois cibles |
| Erreur réseau sur un hub local en HTTP | App Transport Security ou autorisation *Réseau local* refusée | HTTPS ; sinon `NSAllowsLocalNetworking` et `NSLocalNetworkUsageDescription` |

## Liste de contrôle avant publication

- [ ] Le hub est joignable en HTTPS depuis l'extérieur (4G, autre réseau).
- [ ] Les quatre variables `HLT_APNS_*` sont définies ; *Envoyer un test* fonctionne avec un build TestFlight.
- [ ] Même bundle id pour iOS et macOS, égal à `HLT_APNS_TOPIC`.
- [ ] App, widgets et extension de notification partagent l'App Group et le groupe Keychain Sharing.
- [ ] Le mot de passe n'est jamais enregistré ; le jeton est dans le trousseau en `AfterFirstUnlockThisDeviceOnly`.
- [ ] Un `401` ramène à l'écran de connexion ; la déconnexion appelle `POST /auth/logout`.
- [ ] Le flux `/events` est ouvert au premier plan seulement, une seule fois pour toute l'app, avec reconnexion progressive.
- [ ] Les widgets n'appellent que `/widgets` et affichent le cache quand le hub est injoignable.
- [ ] Les clés de préférences propres à l'app sont préfixées `ios.`.
