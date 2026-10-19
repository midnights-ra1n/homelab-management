# Guide Apple : app iOS, iPadOS et macOS pour Midnights Monitoring

Ce guide explique comment bâtir une app SwiftUI qui s'appuie sur l'[API v1](API.md) du hub Midnights Monitoring, avec des notifications push, des widgets interactifs et des préférences partagées avec l'interface web. Il complète la référence : chaque route citée y est décrite en détail.

Le code vise **iOS 17, iPadOS 17 et macOS 14** au minimum : c'est à partir de ces versions que les widgets peuvent porter des boutons (App Intents) et que la macro `@Observable` est disponible. Il est écrit pour Swift 5.10 et Swift 6 ; en mode de langage Swift 6 (concurrence stricte), certaines versions d'Xcode demandent quelques annotations supplémentaires (`@preconcurrency`, `nonisolated(unsafe)`) autour des délégués UIKit / AppKit.

## Sommaire

1. [Architecture](#architecture)
2. [Préparer le serveur](#préparer-le-serveur)
3. [Préparer le compte Apple Developer](#préparer-le-compte-apple-developer)
4. [Préparer le projet Xcode](#préparer-le-projet-xcode)
5. [Modèles Codable](#modèles-codable)
6. [Client HTTP](#client-http)
7. [Jeton et configuration partagés](#jeton-et-configuration-partagés)
8. [Connexion au hub](#connexion-au-hub)
9. [Notifications push](#notifications-push)
10. [Widgets](#widgets)
11. [Widgets interactifs et App Intents](#widgets-interactifs-et-app-intents)
12. [Préférences synchronisées](#préférences-synchronisées)
13. [Rafraîchissement des données](#rafraîchissement-des-données)
14. [Sécurité](#sécurité)
15. [Dépannage](#dépannage)
16. [Liste de contrôle avant publication](#liste-de-contrôle-avant-publication)

## Architecture

```
            ┌──────────── iPhone / iPad / Mac ─────────────┐
            │  App SwiftUI ─┐                               │
            │  Widgets ─────┼─ HubKit (modèles + client) ───┼── HTTPS ──▶  Hub Midnights Monitoring
            │  Extension de │   Trousseau partagé (jeton)   │             /api/v1/…
            │  notification ┘   App Group (cache, URL)      │                 │
            └───────────────────────────▲───────────────────┘                 │ changements d'état
                                        │ notification                        ▼
                                        └─────────────── APNs (Apple) ◀── clé .p8 du hub
```

- **Une cible partagée `HubKit`** (package Swift local ou framework) contient les modèles, le client et l'accès au trousseau. L'app, l'extension de widgets et l'extension de notification l'importent.
- **Le hub ne connaît que l'API v1.** L'app n'utilise jamais le cookie de session du tableau de bord : elle s'authentifie avec un jeton d'API, limité à ses scopes.
- **Les notifications partent du hub.** À chaque changement d'état (hôte, sonde, certificat, disque…), le hub regroupe les événements de la fenêtre de regroupement, comme pour les e-mails, et envoie **une** notification à chaque appareil inscrit.
- **Midnights Management** n'expose pas cette API. Les hôtes et l'état vus par l'app sont ceux du monitoring, qui alimente aussi la gestion.

## Préparer le serveur

### 1. Activer l'API et servir le hub en HTTPS

Dans le monitoring, *Réglages → API* : activez l'API et enregistrez. L'app doit joindre le hub en **HTTPS** depuis l'extérieur (reverse proxy avec un certificat valide) : le jeton circule dans chaque requête, et App Transport Security refuse le HTTP par défaut. Voir [HTTP sur le réseau local](#http-sur-le-réseau-local) pour le cas d'un hub uniquement local.

### 2. Créer le jeton de l'app

*Réglages → API → Créer un jeton*. Un jeton par installation de l'app : on peut ainsi révoquer un iPhone perdu sans toucher au Mac.

| Scope | Utilisé pour |
|---|---|
| `status:read` | `/status` et `/widgets` (écran d'accueil, widgets) |
| `hosts:read` | liste et détail des hôtes |
| `monitors:read` | liste, détail et historique des sondes |
| `metrics:read` | graphiques des hôtes |
| `reports:read` | consommation électrique et rapport mensuel |
| `updates:read`, `smart:read`, `docker:read` | écrans mises à jour, disques, conteneurs (si l'app les propose) |
| `maintenance:write` | boutons « Maintenance » de l'app et des widgets |
| `push:write` | inscription aux notifications |
| `preferences:read`, `preferences:write` | préférences partagées avec le web |

N'ajoutez `hosts:write` (suppression d'hôtes, mise à jour d'agent) que si l'app propose ces actions.

### 3. Configurer l'envoi des notifications (APNs)

Le hub envoie les notifications avec une **clé d'authentification APNs** (fichier `.p8`), valable pour toutes vos apps et sans date d'expiration. Il lit quatre variables d'environnement au démarrage :

| Variable | Valeur |
|---|---|
| `HLT_APNS_KEY` | chemin du fichier `.p8` |
| `HLT_APNS_KEY_ID` | identifiant de la clé (10 caractères, visible dans le nom du fichier `AuthKey_XXXXXXXXXX.p8`) |
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

Après redémarrage, *Réglages → API → Appareils* n'affiche plus « APNs non configuré ». Si la clé est illisible ou invalide, le journal du serveur l'indique (`APNs key: …`) et les notifications restent désactivées ; le reste du hub fonctionne normalement.

> Un seul `HLT_APNS_TOPIC` est pris en charge : l'app iOS et l'app macOS doivent partager le **même bundle id** (cible multiplateforme, voir plus bas).

## Préparer le compte Apple Developer

1. **Identifiant d'app** (*Certificates, Identifiers & Profiles → Identifiers*) : créez `fr.midnights.monitoring` avec les capacités *Push Notifications* et *App Groups*. Créez aussi les identifiants des extensions : `fr.midnights.monitoring.widgets` et `fr.midnights.monitoring.notifications`.
2. **App Group** : créez `group.fr.midnights.monitoring` et cochez-le pour les trois identifiants.
3. **Clé APNs** (*Keys → +*) : cochez *Apple Push Notifications service (APNs)*, environnement *Sandbox & Production*. Téléchargez le `.p8` (téléchargeable **une seule fois**) et notez le *Key ID*.

Xcode peut créer les identifiants automatiquement (*Automatically manage signing*) ; la clé APNs, elle, se crée toujours à la main.

## Préparer le projet Xcode

### Cibles

| Cible | Modèle Xcode | Rôle |
|---|---|---|
| App | *Multiplatform → App* | une seule cible pour iOS, iPadOS et macOS, donc un seul bundle id |
| `HubKit` | *Swift Package* local (ou *Framework*) | modèles, client, trousseau, cache |
| Widgets | *Widget Extension* (cochez *Include Configuration App Intent*) | widgets et leurs App Intents |
| Notifications | *Notification Service Extension* | met à jour le cache et recharge les widgets à la réception d'une notification |

Évitez Mac Catalyst pour la version macOS : Xcode lui attribue par défaut un bundle id préfixé `maccatalyst.`, que le hub ne connaîtrait pas.

### Capacités (*Signing & Capabilities*)

| Capacité | App | Widgets | Notifications |
|---|---|---|---|
| Push Notifications | ✓ | | |
| Background Modes → *Remote notifications* (iOS) | ✓ | | |
| App Groups `group.fr.midnights.monitoring` | ✓ | ✓ | ✓ |
| Keychain Sharing, groupe `fr.midnights.shared` | ✓ | ✓ | ✓ |
| Time Sensitive Notifications | ✓ | | |
| App Sandbox → *Outgoing Connections (Client)* (macOS) | ✓ | ✓ | ✓ |

*Time Sensitive Notifications* permet aux pannes (`interruption-level: time-sensitive`) de passer les modes Concentration autorisés par l'utilisateur.

### Info.plist

| Clé | Quand | Valeur |
|---|---|---|
| `NSLocalNetworkUsageDescription` | le hub est joint par une adresse du réseau local | « Pour joindre votre serveur Midnights Monitoring sur le réseau local. » |
| `NSAppTransportSecurity` | uniquement pour un hub local en HTTP | voir ci-dessous |

#### HTTP sur le réseau local

Gardez HTTPS dès que possible. Pour un hub joint uniquement sur le réseau local en HTTP, `NSAppTransportSecurity → NSAllowsLocalNetworking = YES` autorise les noms sans domaine et les noms en `.local` ; pour un autre nom, ajoutez une exception `NSExceptionDomains` limitée à ce nom avec `NSExceptionAllowsInsecureHTTPLoads`. N'activez jamais `NSAllowsArbitraryLoads`. Le jeton circulant en clair, réservez ce cas à un réseau de confiance.

## Modèles Codable

Les réponses sont en `snake_case`. **N'utilisez pas `keyDecodingStrategy = .convertFromSnakeCase`** : cette stratégie convertit aussi les clés des **dictionnaires**. `by_status` contiendrait alors `majorOutage` au lieu de `major_outage`, et les clés des préférences (`monitors_view`) seraient réécrites. Les modèles ci-dessous déclarent donc leurs `CodingKeys`, et le décodeur ne fait que la conversion des dates.

```swift
// HubKit/Coding.swift
import Foundation

public extension JSONDecoder {
    /// Horodatages en secondes Unix. Les quelques champs en millisecondes sont déclarés en Int64.
    static let hub: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return d
    }()
}

public extension JSONEncoder {
    static let hub = JSONEncoder()
}
```

### États

```swift
// HubKit/Status.swift
import Foundation

public enum HubStatus: String, Codable, Sendable, CaseIterable, Comparable {
    case operational, maintenance, degraded
    case minorOutage = "minor_outage"
    case majorOutage = "major_outage"
    case unknown

    /// Une valeur ajoutée dans une version future du hub ne casse pas le décodage.
    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = HubStatus(rawValue: raw) ?? .unknown
    }

    /// Du meilleur au pire, comme le hub (unknown à part).
    public var rank: Int {
        switch self {
        case .operational: 0
        case .maintenance: 1
        case .degraded: 2
        case .minorOutage: 3
        case .majorOutage: 4
        case .unknown: -1
        }
    }

    public static func < (a: HubStatus, b: HubStatus) -> Bool { a.rank < b.rank }

    public var label: String {
        switch self {
        case .operational: "Opérationnel"
        case .maintenance: "Maintenance"
        case .degraded: "Performances dégradées"
        case .minorOutage: "Panne partielle"
        case .majorOutage: "Panne majeure"
        case .unknown: "En attente"
        }
    }

    public var symbol: String {
        switch self {
        case .operational: "checkmark.circle.fill"
        case .maintenance: "wrench.and.screwdriver.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .minorOutage, .majorOutage: "xmark.octagon.fill"
        case .unknown: "clock.fill"
        }
    }
}

public struct StatusCounts: Codable, Sendable {
    public let total: Int
    public let byStatus: [String: Int]
    enum CodingKeys: String, CodingKey { case total, byStatus = "by_status" }

    public func count(_ s: HubStatus) -> Int { byStatus[s.rawValue] ?? 0 }
    public var down: Int { count(.minorOutage) + count(.majorOutage) }
}

/// GET /status
public struct StatusSummary: Codable, Sendable {
    public let status: HubStatus
    public let hosts: StatusCounts
    public let monitors: StatusCounts
    public let time: Date
}

/// GET /widgets
public struct WidgetSummary: Codable, Sendable {
    public struct Problem: Codable, Sendable, Hashable {
        public enum Kind: String, Codable, Sendable { case host, monitor }
        public let kind: Kind
        public let id: Int
        public let name: String
        public let status: HubStatus
        public let message: String
    }
    public struct Power: Codable, Sendable {
        public let plugs: Int
        public let nowW: Double?
        public let avg24hW: Double?
        enum CodingKeys: String, CodingKey { case plugs, nowW = "now_w", avg24hW = "avg_24h_w" }
    }
    public let status: HubStatus
    public let hosts: StatusCounts
    public let monitors: StatusCounts
    public let problems: [Problem]
    public let power: Power
    public let time: Date
}
```

### Hôtes

Le type s'appelle `MonitoredHost` pour ne pas masquer `Foundation.Host` sur macOS.

```swift
// HubKit/Hosts.swift
import Foundation

public struct MonitoredHost: Codable, Sendable, Identifiable {
    public let id: Int
    public let name: String
    public let status: HubStatus
    /// Epoch (1970) si l'agent ne s'est jamais connecté.
    public let lastSeen: Date
    public let maintenance: Bool
    public let isPublic: Bool
    public let connected: Bool
    public let info: Info
    public let latest: Latest
    public let updates: Updates?
    public let action: Action?
    public let docker: DockerSnapshot?
    public let agentLatest: String
    public let agentOutdated: Bool
    /// Agent silencieux : true = l'hôte répond au ping (« agent injoignable, hôte en ligne »),
    /// false = hors ligne. nil quand l'agent répond ou que le ping n'a pas été tenté.
    public let ping: Bool?
    public let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, name, status, maintenance, connected, info, latest, updates, action, docker, ping
        case lastSeen = "last_seen", isPublic = "public", agentLatest = "agent_latest"
        case agentOutdated = "agent_outdated", createdAt = "created_at"
    }

    public var neverSeen: Bool { lastSeen.timeIntervalSince1970 == 0 }

    /// Libellé identique à l'interface web.
    public var statusLabel: String {
        switch ping {
        case true?: "Agent injoignable · hôte en ligne"
        case false?: "Hors ligne · injoignable"
        case nil: status.label
        }
    }

    public struct Info: Codable, Sendable {
        public let hostname: String?
        public let os: String?
        public let osVersion: String?
        public let kernel: String?
        public let arch: String?
        public let cpuModel: String?
        public let cpuCores: Int?
        public let memTotal: Int64?
        public let agentVersion: String?
        public let bootTime: Date?
        public let virtualization: String?
        public let manufacturer: String?
        public let model: String?
        public let ips: [IP]?

        public struct IP: Codable, Sendable { public let iface: String; public let address: String; public let prefix: Int; public let mac: String? }

        enum CodingKeys: String, CodingKey {
            case hostname, os, kernel, arch, virtualization, manufacturer, model, ips
            case osVersion = "os_version", cpuModel = "cpu_model", cpuCores = "cpu_cores"
            case memTotal = "mem_total", agentVersion = "agent_version", bootTime = "boot_time"
        }
    }

    public struct Latest: Codable, Sendable {
        public let cpu: Double?
        public let memUsed, memTotal, swapUsed, swapTotal, diskUsed, diskTotal: Int64?
        /// Octets par seconde.
        public let netRx, netTx: Double?
        public let load1: Double?
        public let temp, cpuTemp: Double?
        public let disks: [Disk]?
        public let temps: [Temp]?
        public let ifaces: [Iface]?

        public struct Disk: Codable, Sendable { public let mount: String; public let fs: String; public let used: Int64; public let total: Int64 }
        public struct Temp: Codable, Sendable { public let label: String; public let c: Double }
        public struct Iface: Codable, Sendable { public let name: String; public let rx: Double; public let tx: Double }

        enum CodingKeys: String, CodingKey {
            case cpu, load1, temp, disks, temps, ifaces
            case memUsed = "mem_used", memTotal = "mem_total", swapUsed = "swap_used", swapTotal = "swap_total"
            case diskUsed = "disk_used", diskTotal = "disk_total", netRx = "net_rx", netTx = "net_tx", cpuTemp = "cpu_temp"
        }

        public var memPercent: Double? { ratio(memUsed, memTotal) }
        public var diskPercent: Double? { ratio(diskUsed, diskTotal) }
        private func ratio(_ a: Int64?, _ b: Int64?) -> Double? {
            guard let a, let b, b > 0 else { return nil }
            return Double(a) * 100 / Double(b)
        }
    }

    public struct Updates: Codable, Sendable {
        public let manager: String
        public let packages: [Package]?
        public let rebootRequired: Bool
        public let listsUpdatedAt: Date
        public let checkedAt: Date
        public let pending: Int
        public let security: Int

        public struct Package: Codable, Sendable, Hashable {
            public let name, current, candidate: String
            public let security: Bool
        }

        enum CodingKeys: String, CodingKey {
            case manager, packages, pending, security
            case rebootRequired = "reboot_required", listsUpdatedAt = "lists_updated_at", checkedAt = "checked_at"
        }
    }

    public struct Action: Codable, Sendable {
        /// check_updates, apply_updates, update_agent, update_container
        public let action: String
        public let target: String?
        /// pending, running, done, failed
        public let state: String
        public let message: String
        public let at: Date
    }
}

/// GET /hosts/{id}/metrics : colonnes alignées sur t.
public struct HostMetrics: Codable, Sendable {
    public let t: [Date]
    public let cpu, mem, swap, disk, load1, temp: [Double?]
    public let netRx, netTx: [Double?]
    enum CodingKeys: String, CodingKey { case t, cpu, mem, swap, disk, load1, temp, netRx = "net_rx", netTx = "net_tx" }
}
```

### Sondes

```swift
// HubKit/Monitors.swift
import Foundation

public struct Monitor: Codable, Sendable, Identifiable {
    public enum Kind: String, Codable, Sendable {
        case http, tcp, dns, ssl, snmp, meross, other
        public init(from decoder: Decoder) throws {
            self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .other
        }
    }

    public let id: Int
    public let name: String
    public let type: Kind
    public let target: String
    public let intervalS: Int
    public let timeoutS: Int
    public let config: Config
    public let enabled: Bool
    public let maintenance: Bool
    public let isPublic: Bool
    public let status: HubStatus
    public let message: String
    public let latencyMs: Double?
    /// Millisecondes Unix (exception à la règle des secondes).
    public let lastCheck: Int64
    public let certExpiresAt: Date?
    public let days: [Day]?

    public var lastCheckDate: Date? { lastCheck > 0 ? Date(timeIntervalSince1970: Double(lastCheck) / 1000) : nil }

    enum CodingKeys: String, CodingKey {
        case id, name, type, target, config, enabled, maintenance, status, message, days
        case intervalS = "interval_s", timeoutS = "timeout_s", isPublic = "public"
        case latencyMs = "latency_ms", lastCheck = "last_check", certExpiresAt = "cert_expires_at"
    }

    /// Sous-ensemble utile à l'affichage ; les secrets ne sont jamais renvoyés.
    public struct Config: Codable, Sendable {
        public let unit: String?
        public let minValue, maxValue: Double?
        /// snmp : nil ou "" (OID), "in" / "out" (débit en Mbit/s), "ifstatus" (état d'interface, ex. WireGuard)
        public let snmpMode: String?
        public let interface: String?
        /// snmp in/out : seuil d'utilisation du lien en % ; ifstatus : minutes sans trafic reçu avant la panne
        public let maxPercent: Double?
        public let idleMinutes: Int?
        public let warnDays: Int?
        enum CodingKeys: String, CodingKey {
            case unit, interface
            case minValue = "min_value", maxValue = "max_value", snmpMode = "snmp_mode", warnDays = "warn_days"
            case maxPercent = "max_percent", idleMinutes = "idle_minutes"
        }
    }

    public struct Day: Codable, Sendable {
        public let day: Date
        /// 0…1, nil sans mesure
        public let uptime: Double?
        public let worst: HubStatus
    }

    /// Unité de la valeur des sondes snmp / meross.
    public var unit: String { type == .meross ? "W" : config.unit ?? "" }
}

/// GET /monitors/{id}/results
public struct MonitorResults: Codable, Sendable {
    public let t: [Date]
    public let latency: [Double?]
    /// Valeur snmp, ou watts pour meross.
    public let value: [Double?]
    public let worst: [HubStatus]
    public let recent: [Check]

    public struct Check: Codable, Sendable {
        /// Millisecondes Unix.
        public let ts: Int64
        public let status: HubStatus
        public let latencyMs: Double?
        public let message: String
        public var date: Date { Date(timeIntervalSince1970: Double(ts) / 1000) }
        enum CodingKeys: String, CodingKey { case ts, status, message, latencyMs = "latency_ms" }
    }
}
```

### Bande passante

```swift
// HubKit/Bandwidth.swift
import Foundation

/// GET /bandwidth : interfaces suivies par SNMP, débits en Mbit/s.
public struct BandwidthView: Codable, Sendable {
    public let range: String
    /// Début de chaque tranche ; in.series et out.series sont alignés dessus.
    public let t: [Date]
    /// Les 31 derniers minuits (fuseau du hub) ; Side.dailyOctets est aligné dessus.
    public let days: [Date]
    public let links: [Link]

    public struct Link: Codable, Sendable, Hashable {
        public let target: String
        public let interface: String
        public let status: HubStatus
        /// Vitesse de l'interface annoncée par l'équipement, nil si inconnue.
        public let speedMbps: Double?
        public let `in`: Side?
        public let out: Side?
        public let state: State?
        enum CodingKeys: String, CodingKey {
            case target, interface, status, `in`, out, state
            case speedMbps = "speed_mbps"
        }
    }

    public struct Side: Codable, Sendable, Hashable {
        public let monitorID: Int
        public let name: String
        public let status: HubStatus
        public let message: String
        public let currentMbps, avgMbps, peakMbps: Double?
        public let series: [Double?]
        /// Volume de données en octets : aujourd'hui, ce mois-ci, par jour (aligné sur days).
        public let todayOctets, monthOctets: Int64
        public let dailyOctets: [Int64]
        enum CodingKeys: String, CodingKey {
            case name, status, message, series
            case monitorID = "monitor_id", currentMbps = "current_mbps", avgMbps = "avg_mbps", peakMbps = "peak_mbps"
            case todayOctets = "today_octets", monthOctets = "month_octets", dailyOctets = "daily_octets"
        }
    }

    public struct State: Codable, Sendable, Hashable {
        public let monitorID: Int
        public let name: String
        public let status: HubStatus
        public let message: String
        enum CodingKeys: String, CodingKey { case name, status, message, monitorID = "monitor_id" }
    }
}
```

```swift
/// GET /snmp/devices : équipements SNMP et leurs interfaces (lecture à la demande, pas en boucle).
public struct SNMPDevices: Codable, Sendable {
    public let devices: [Device]

    public struct Device: Codable, Sendable, Hashable {
        public let target, sysName, sysDescr: String
        public let uptimeS: Int64
        public let interfaces: [Interface]
        /// Présent si l'équipement n'a pas pu être lu.
        public let error: String?
        enum CodingKeys: String, CodingKey {
            case target, interfaces, error
            case sysName = "sys_name", sysDescr = "sys_descr", uptimeS = "uptime_s"
        }
    }

    public struct Interface: Codable, Sendable, Hashable, Identifiable {
        public var id: Int { index }
        public let index: Int
        public let name, descr, alias, status: String
        public let up: Bool
        public let speedMbps: Double?
        /// Depuis le démarrage de l'équipement.
        public let inOctets, outOctets: UInt64?
        public let addresses: [String]
        public let defaultRoute: Bool
        /// "wan", "lan", "vpn", "system", "loopback" ou "" : deviné, pour aider à choisir.
        public let role: String
        /// Signification d'Entrant / Sortant sur cette interface, en français.
        public let hint: String
        public let probes: [Probe]
        enum CodingKeys: String, CodingKey {
            case index, name, descr, alias, status, up, addresses, role, hint, probes
            case speedMbps = "speed_mbps", inOctets = "in_octets", outOctets = "out_octets", defaultRoute = "default_route"
        }
    }

    public struct Probe: Codable, Sendable, Hashable {
        public let id: Int
        public let name, mode: String
    }
}
```

Avec Swift Charts, tracez `zip(view.t, link.in?.series ?? [])` en `LineMark`, en ignorant les valeurs `nil`, et `zip(view.days, link.in?.dailyOctets ?? [])` en `BarMark` pour le volume par jour. Pour afficher des octets comme l'interface web, `ByteCountFormatter` avec `countStyle = .decimal` (1 Mo = 10⁶ octets) ; un débit en octets par seconde vaut `mbps × 125_000`.

**Temps réel** : `GET /bandwidth/live` renvoie le débit lu à l'instant ; interrogez-le toutes les 2 secondes tant que l'écran est visible (`.task` + `Task.sleep`), et gardez une fenêtre glissante des 150 dernières valeurs (5 minutes). Ne l'utilisez pas dans un widget : WidgetKit ne rafraîchit pas à cette cadence.

```swift
public struct LiveBandwidth: Codable, Sendable {
    /// Millisecondes Unix.
    public let at: Int64
    public let samples: [Sample]
    public struct Sample: Codable, Sendable {
        public let monitorID: Int
        public let mode: String      // in, out
        public let mbps: Double?
        public let error: String?
        enum CodingKeys: String, CodingKey { case mode, mbps, error, monitorID = "monitor_id" }
    }
}
```

### Mises à jour, disques, conteneurs, énergie

```swift
// HubKit/Reports.swift
import Foundation

/// GET /updates
public struct HostUpdatesEntry: Codable, Sendable {
    public let hostID: Int
    public let host: String
    public let updates: MonitoredHost.Updates
    enum CodingKeys: String, CodingKey { case host, updates, hostID = "host_id" }
}

/// GET /disks
public struct HostDisks: Codable, Sendable {
    public let hostID: Int
    public let host: String
    public let collectedAt: Date
    public let error: String?
    public let disks: [Disk]?

    public struct Disk: Codable, Sendable {
        public enum Health: String, Codable, Sendable { case good, watch, replace, failing }
        public let name, model, serial: String
        /// hdd, ssd, nvme
        public let kind: String
        public let capacityBytes: Int64
        public let temperatureC: Double?
        public let powerOnHours: Double?
        public let wearUsedPct: Double?
        public let health: Health
        public let score: Int
        public let usable: Bool
        public let summary: String
        public let reasons: [String]?
        public let lifeLeftDays: Int?
        enum CodingKeys: String, CodingKey {
            case name, model, serial, kind, health, score, usable, summary, reasons
            case capacityBytes = "capacity_bytes", temperatureC = "temperature_c", powerOnHours = "power_on_hours"
            case wearUsedPct = "wear_used_pct", lifeLeftDays = "life_left_days"
        }
    }

    enum CodingKeys: String, CodingKey { case host, error, disks, hostID = "host_id", collectedAt = "collected_at" }
}

/// GET /containers
public struct HostContainers: Codable, Sendable {
    public let hostID: Int
    public let host: String
    public let docker: DockerSnapshot
    enum CodingKeys: String, CodingKey { case host, docker, hostID = "host_id" }
}

public struct DockerSnapshot: Codable, Sendable {
    public let collectedAt: Date
    public let running: Int
    public let updatesAvailable: Int
    public let error: String?
    public let containers: [Container]?

    public struct Container: Codable, Sendable, Identifiable {
        public let id, name, image, state, health: String
        /// ISO 8601, à lire avec ISO8601DateFormatter (fractions de seconde possibles).
        public let startedAt: String
        public let restartCount: Int
        public let cpuPct, memUsed, memLimit: Double?
        /// up_to_date, available, unknown, local, pinned
        public let update: String
        public let composeProject, composeService: String
        enum CodingKeys: String, CodingKey {
            case id, name, image, state, health, update
            case startedAt = "started_at", restartCount = "restart_count", cpuPct = "cpu_pct"
            case memUsed = "mem_used", memLimit = "mem_limit"
            case composeProject = "compose_project", composeService = "compose_service"
        }
    }

    enum CodingKeys: String, CodingKey {
        case running, error, containers
        case collectedAt = "collected_at", updatesAvailable = "updates_available"
    }
}

/// GET /reports/energy?days=n (Wh)
public struct EnergyReport: Codable, Sendable {
    public let from, to: Date
    /// Minuit UTC de chaque jour ; plugs[].daily est aligné dessus.
    public let days: [Date]
    public let totalWh: Double
    public let avgDayWh, avgWeekWh, avgMonthWh: Double?
    public let plugs: [Plug]

    public struct Plug: Codable, Sendable, Identifiable {
        public let id: Int
        public let name: String
        public let totalWh: Double
        public let avgDayWh, avgWeekWh, avgMonthWh: Double?
        public let daily: [Double?]
        enum CodingKeys: String, CodingKey {
            case id, name, daily
            case totalWh = "total_wh", avgDayWh = "avg_day_wh", avgWeekWh = "avg_week_wh", avgMonthWh = "avg_month_wh"
        }
    }

    enum CodingKeys: String, CodingKey {
        case from, to, days, plugs
        case totalWh = "total_wh", avgDayWh = "avg_day_wh", avgWeekWh = "avg_week_wh", avgMonthWh = "avg_month_wh"
    }

    /// Puissance moyenne sur la période, en watts.
    public var averageWatts: Double? { avgDayWh.map { $0 / 24 } }
}
```

### Notifications et préférences

```swift
// HubKit/Push.swift
import Foundation

/// Élément de "events" dans la charge utile d'une notification.
public struct PushEvent: Codable, Sendable, Hashable {
    /// Hôte, Sonde, Certificat SSL, Disque, Mises à jour, Redémarrage, Image Docker, Test
    public let kind: String
    public let name: String
    public let from: HubStatus?
    public let to: HubStatus?
    public let message: String?
    public let at: Date

    /// Extrait les événements du userInfo d'une notification.
    public static func decode(_ userInfo: [AnyHashable: Any]) -> [PushEvent] {
        guard let raw = userInfo["events"],
              let data = try? JSONSerialization.data(withJSONObject: raw) else { return [] }
        return (try? JSONDecoder.hub.decode([PushEvent].self, from: data)) ?? []
    }
}

public struct DeviceRegistration: Codable, Sendable {
    public let token: String
    /// false tant que le hub n'a pas de clé APNs : l'inscription est gardée, mais rien n'est envoyé.
    public let pushEnabled: Bool
    enum CodingKeys: String, CodingKey { case token, pushEnabled = "push_enabled" }
}

/// Valeur JSON quelconque, pour les préférences.
public enum JSONValue: Codable, Sendable, Hashable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }

    public var string: String? { if case .string(let v) = self { v } else { nil } }
}

public typealias Preferences = [String: JSONValue]
```

## Client HTTP

Un `actor` sérialise l'accès à la configuration et se partage entre l'app et les extensions.

```swift
// HubKit/Hub.swift
import Foundation

public struct HubConfiguration: Sendable, Equatable {
    public var baseURL: URL   // https://monitoring.example.fr (sans /api/v1)
    public var token: String  // hlm_…
    public init(baseURL: URL, token: String) { self.baseURL = baseURL; self.token = token }
}

public enum HubError: LocalizedError, Sendable {
    case notConfigured
    /// Réponse d'erreur du hub : message en français, prêt à afficher.
    case http(status: Int, message: String)
    case rateLimited(retryAfter: TimeInterval)
    case transport(URLError)
    case decoding(String)

    public var errorDescription: String? {
        switch self {
        case .notConfigured: "Aucun hub configuré."
        case .http(_, let message): message
        case .rateLimited(let s): "Trop de requêtes, nouvel essai dans \(Int(s)) s."
        case .transport(let e): e.localizedDescription
        case .decoding(let d): "Réponse inattendue du hub (\(d))."
        }
    }

    /// 401 : jeton révoqué ou expiré, à redemander. 404 sur /api/v1 : API désactivée.
    public var needsNewToken: Bool { if case .http(401, _) = self { true } else { false } }
    public var missingScope: Bool { if case .http(403, _) = self { true } else { false } }
}

public actor Hub {
    public static let shared = Hub()

    private var config: HubConfiguration?
    private let session: URLSession

    public init(config: HubConfiguration? = HubStore.load()) {
        self.config = config
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 15
        c.waitsForConnectivity = false
        c.urlCache = nil // le hub répond no-store
        session = URLSession(configuration: c)
    }

    public func configure(_ config: HubConfiguration?) { self.config = config }

    // MARK: Transport

    func data(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil) async throws -> Data {
        guard let config else { throw HubError.notConfigured }
        var url = config.baseURL.appending(path: "api/v1").appending(path: path)
        if !query.isEmpty { url.append(queryItems: query) }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        for attempt in 0..<2 {
            let (data, response): (Data, URLResponse)
            do { (data, response) = try await session.data(for: req) }
            catch let e as URLError { throw HubError.transport(e) }
            let http = response as! HTTPURLResponse
            switch http.statusCode {
            case 200..<300:
                return data
            case 429:
                let wait = TimeInterval(http.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 5
                // Une seule nouvelle tentative, et seulement si l'attente est courte.
                guard attempt == 0, wait <= 10 else { throw HubError.rateLimited(retryAfter: wait) }
                try await Task.sleep(for: .seconds(wait))
            default:
                struct Body: Decodable { let error: String }
                let message = (try? JSONDecoder().decode(Body.self, from: data))?.error
                    ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
                throw HubError.http(status: http.statusCode, message: message)
            }
        }
        throw HubError.rateLimited(retryAfter: 60)
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try decode(await data("GET", path, query: query))
    }

    func send<T: Decodable>(_ method: String, _ path: String, body: some Encodable) async throws -> T {
        try decode(await data(method, path, body: JSONEncoder.hub.encode(body)))
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try JSONDecoder.hub.decode(T.self, from: data) }
        catch { throw HubError.decoding(String(describing: error)) }
    }
}
```

### Une méthode par route

```swift
// HubKit/Hub+Routes.swift
import Foundation

public enum HistoryRange: String, Sendable, CaseIterable {
    case hour = "1h", sixHours = "6h", day = "24h", week = "7d", month = "30d", quarter = "90d"
}

public enum ItemKind: String, Sendable { case host = "hosts", monitor = "monitors" }

public extension Hub {
    func status() async throws -> StatusSummary { try await get("/status") }
    func widgets() async throws -> WidgetSummary { try await get("/widgets") }

    func hosts(withPackages: Bool = false) async throws -> [MonitoredHost] {
        try await get("/hosts", query: withPackages ? [URLQueryItem(name: "packages", value: "1")] : [])
    }
    func host(_ id: Int) async throws -> MonitoredHost { try await get("/hosts/\(id)") }
    func metrics(host id: Int, range: HistoryRange = .day) async throws -> HostMetrics {
        try await get("/hosts/\(id)/metrics", query: [URLQueryItem(name: "range", value: range.rawValue)])
    }
    /// Renvoie l'hôte avec action.state = pending ; relire l'hôte pour suivre la mise à jour.
    func updateAgent(host id: Int) async throws -> MonitoredHost {
        try decodeHost(await data("POST", "/hosts/\(id)/agent-update"))
    }

    func monitors() async throws -> [Monitor] { try await get("/monitors") }
    func monitor(_ id: Int) async throws -> Monitor { try await get("/monitors/\(id)") }
    func results(monitor id: Int, range: HistoryRange = .day) async throws -> MonitorResults {
        try await get("/monitors/\(id)/results", query: [URLQueryItem(name: "range", value: range.rawValue)])
    }

    func setMaintenance(_ on: Bool, _ kind: ItemKind, id: Int) async throws {
        struct Body: Codable { let maintenance: Bool }
        let _: Body = try await send("PUT", "/\(kind.rawValue)/\(id)/maintenance", body: Body(maintenance: on))
    }

    func bandwidth(range: HistoryRange = .day) async throws -> BandwidthView {
        try await get("/bandwidth", query: [URLQueryItem(name: "range", value: range.rawValue)])
    }

    func liveBandwidth() async throws -> LiveBandwidth { try await get("/bandwidth/live") }

    func updates() async throws -> [HostUpdatesEntry] { try await get("/updates") }
    func disks() async throws -> [HostDisks] { try await get("/disks") }
    func containers() async throws -> [HostContainers] { try await get("/containers") }
    func energy(days: Int = 30) async throws -> EnergyReport {
        try await get("/reports/energy", query: [URLQueryItem(name: "days", value: String(days))])
    }

    func registerDevice(_ deviceToken: Data, name: String, sandbox: Bool) async throws -> DeviceRegistration {
        struct Body: Encodable { let token: String; let name: String; let sandbox: Bool }
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        return try await send("POST", "/devices", body: Body(token: hex, name: name, sandbox: sandbox))
    }
    func unregisterDevice(hexToken: String) async throws {
        _ = try await data("DELETE", "/devices/\(hexToken)")
    }

    func preferences() async throws -> Preferences { try await get("/preferences") }
    /// Fusion côté serveur : seules les clés envoyées changent ; .null supprime une clé.
    func updatePreferences(_ changes: Preferences) async throws -> Preferences {
        try await send("PUT", "/preferences", body: changes)
    }

    private func decodeHost(_ data: Data) throws -> MonitoredHost {
        try JSONDecoder.hub.decode(MonitoredHost.self, from: data)
    }
}
```

Exemple d'écran :

```swift
struct HostsView: View {
    @State private var hosts: [MonitoredHost] = []
    @State private var error: String?

    var body: some View {
        List(hosts) { h in
            Label {
                VStack(alignment: .leading) {
                    Text(h.name)
                    Text(h.statusLabel).font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: h.status.symbol)
            }
        }
        .overlay { if let error { ContentUnavailableView("Hub injoignable", systemImage: "wifi.exclamationmark", description: Text(error)) } }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do { hosts = try await Hub.shared.hosts(); error = nil }
        catch { self.error = error.localizedDescription }
    }
}
```

## Jeton et configuration partagés

Le jeton est un secret : il va dans le **trousseau**, jamais dans `UserDefaults`. L'adresse du hub et le cache des widgets vont dans les `UserDefaults` de l'**App Group**, lisibles par les trois cibles.

```swift
// HubKit/HubStore.swift
import Foundation
import Security

public enum HubStore {
    static let group = "group.fr.midnights.monitoring"
    /// Groupe Keychain Sharing, préfixé par l'identifiant d'équipe.
    static let keychainGroup = "TEAM123456.fr.midnights.shared"
    static let service = "fr.midnights.monitoring"

    public static let defaults = UserDefaults(suiteName: group)!

    public static func load() -> HubConfiguration? {
        guard let url = defaults.url(forKey: "hubURL"), let token = readToken() else { return nil }
        return HubConfiguration(baseURL: url, token: token)
    }

    public static func save(_ config: HubConfiguration?) throws {
        if let config {
            defaults.set(config.baseURL, forKey: "hubURL")
            try writeToken(config.token)
        } else {
            defaults.removeObject(forKey: "hubURL")
            SecItemDelete(baseQuery as CFDictionary)
        }
    }

    private static var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "api-token",
         kSecAttrAccessGroup as String: keychainGroup,
         // Nécessaire sur macOS pour partager l'élément entre l'app et ses extensions.
         kSecUseDataProtectionKeychain as String: true]
    }

    private static func readToken() -> String? {
        var q = baseQuery
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func writeToken(_ token: String) throws {
        SecItemDelete(baseQuery as CFDictionary)
        var q = baseQuery
        q[kSecValueData as String] = Data(token.utf8)
        // Lisible après le premier déverrouillage : les widgets et les notifications en ont besoin écran verrouillé.
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
}
```

`ThisDeviceOnly` empêche le jeton de partir dans les sauvegardes iCloud et sur un autre appareil : chaque appareil a son propre jeton, révocable séparément.

## Connexion au hub

L'écran de connexion demande l'adresse du hub et le jeton, puis vérifie les deux avec `/status` avant d'enregistrer.

```swift
@MainActor
func connect(urlText: String, token: String) async throws {
    guard var comps = URLComponents(string: urlText.trimmingCharacters(in: .whitespaces)),
          comps.scheme == "https" || comps.scheme == "http", comps.host != nil else {
        throw HubError.http(status: 400, message: "Adresse invalide, par exemple https://monitoring.example.fr")
    }
    comps.path = ""
    let config = HubConfiguration(baseURL: comps.url!, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
    let probe = Hub(config: config)
    do {
        _ = try await probe.status()
    } catch HubError.http(404, _) {
        throw HubError.http(status: 404, message: "L'API est désactivée : Réglages → API dans le monitoring.")
    }
    try HubStore.save(config)
    await Hub.shared.configure(config)
}
```

| Réponse de `/status` | Message à afficher |
|---|---|
| `200` | connexion réussie |
| `401` | jeton invalide, révoqué ou expiré |
| `403` | le jeton n'a pas `status:read` |
| `404` | API désactivée, ou adresse qui n'est pas un hub Midnights Monitoring |
| erreur réseau | hub injoignable (adresse, VPN, certificat) |

Testez ensuite les autres scopes au besoin : un `403` sur `/preferences` ou `/devices` signifie que la fonction correspondante doit être masquée, pas que la connexion a échoué.

À la déconnexion : désinscrivez l'appareil (`DELETE /devices/{token}`), puis effacez la configuration avec `HubStore.save(nil)`.

## Notifications push

### Ce que le hub envoie

Une notification par fenêtre de regroupement (60 secondes par défaut, *Réglages → Notifications par e-mail → Fenêtre de regroupement* ; ce réglage vaut aussi pour les notifications push, même si l'envoi d'e-mails est désactivé), avec tous les changements d'état de cette fenêtre :

```json
{
  "aps": {
    "alert": { "title": "2 service(s) en panne", "body": "nas : Panne partielle · Agent injoignable, l'hôte répond au ping\nNextcloud : Panne majeure · Requête échouée : …" },
    "sound": "default",
    "thread-id": "midnights-monitoring",
    "mutable-content": 1,
    "interruption-level": "time-sensitive"
  },
  "events": [
    { "kind": "Hôte", "name": "nas", "from": "operational", "to": "minor_outage", "message": "Agent injoignable, l'hôte répond au ping", "at": 1792046280 },
    { "kind": "Sonde", "name": "Nextcloud", "from": "operational", "to": "major_outage", "message": "Requête échouée : …", "at": 1792046291 }
  ]
}
```

- Le titre et le texte sont prêts à afficher : aucune extension n'est nécessaire pour une notification lisible.
- `interruption-level` vaut `time-sensitive` quand un élément passe en panne partielle ou majeure, `active` sinon (retour à la normale, avertissements).
- `mutable-content: 1` réveille l'extension de notification, qui rafraîchit les widgets (voir plus bas).
- Les événements ne portent pas d'identifiant d'élément : retrouvez l'hôte ou la sonde par `name` dans `/hosts` ou `/monitors`.
- Toutes les notifications vont à tous les appareils inscrits. Les interrupteurs de *Réglages → Notifications par e-mail* (mises à jour de sécurité, redémarrage requis, images Docker, niveau SMART) s'appliquent aussi au push ; il n'existe pas de filtre propre à un appareil.

### Inscription (app SwiftUI multiplateforme)

```swift
// App/MidnightsApp.swift
import SwiftUI
import UserNotifications
#if os(iOS)
import UIKit
#else
import AppKit
#endif

@main
struct MidnightsApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    #else
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    #endif

    var body: some Scene {
        WindowGroup { RootView() }
    }
}

enum Push {
    /// À appeler après la connexion au hub, puis à chaque lancement : le jeton APNs peut changer.
    @MainActor static func enable() async {
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return }
        #if os(iOS)
        UIApplication.shared.registerForRemoteNotifications()
        #else
        NSApplication.shared.registerForRemoteNotifications()
        #endif
    }

    static func register(_ deviceToken: Data) async {
        #if DEBUG
        let sandbox = true   // build Xcode signé en développement
        #else
        let sandbox = false  // TestFlight, App Store
        #endif
        do {
            let r = try await Hub.shared.registerDevice(deviceToken, name: deviceName, sandbox: sandbox)
            HubStore.defaults.set(r.token, forKey: "apnsToken")
        } catch {
            print("Inscription push refusée : \(error.localizedDescription)")
        }
    }

    static var deviceName: String {
        #if os(iOS)
        // Depuis iOS 16, le nom choisi par l'utilisateur demande l'entitlement
        // com.apple.developer.device-information.user-assigned-device-name ; sinon « iPhone ».
        UIDevice.current.name
        #else
        Host.current().localizedName ?? "Mac"
        #endif
    }
}

final class AppDelegate: NSObject, UNUserNotificationCenterDelegate {
    /// Notification reçue app ouverte : on l'affiche quand même.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    /// Tap sur la notification : ouvrir l'élément concerné.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let events = PushEvent.decode(response.notification.request.content.userInfo)
        await Router.shared.open(events.first)
    }
}

#if os(iOS)
extension AppDelegate: UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await Push.register(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("APNs indisponible : \(error.localizedDescription)")
    }
}
#else
extension AppDelegate: NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        UNUserNotificationCenter.current().delegate = self
    }
    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await Push.register(deviceToken) }
    }
    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("APNs indisponible : \(error.localizedDescription)")
    }
}
#endif
```

`Router` est votre navigation (par exemple un `@Observable` avec un `NavigationPath`) : pour `kind == "Hôte"`, chargez `/hosts` et ouvrez celui qui porte `name` ; pour `"Sonde"`, faites de même avec `/monitors`.

L'environnement APNs doit correspondre à la signature : `#if DEBUG` convient tant que les builds Debug sont signés « Development » et les builds Release « Distribution ». Si ce n'est pas le cas chez vous, ajoutez une clé `APSEnvironment` à l'Info.plist, valorisée depuis les réglages de build, et lisez-la à la place.

### Extension de notification : widgets à jour

Quand une notification arrive, l'extension relit `/widgets`, met à jour le cache partagé et demande à WidgetKit de redessiner. Elle dispose d'environ 30 secondes.

```swift
// Notifications/NotificationService.swift
import UserNotifications
import WidgetKit
import HubKit

final class NotificationService: UNNotificationServiceExtension {
    private var task: Task<Void, Never>?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        let content = request.content
        nonisolated(unsafe) let contentHandler = contentHandler
        task = Task {
            if let summary = try? await Hub.shared.widgets() {
                WidgetCache.save(summary)
            }
            WidgetCenter.shared.reloadAllTimelines()
            contentHandler(content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        task?.cancel()
    }
}
```

`contentHandler` doit être appelé dans tous les cas, sinon la notification s'affiche après expiration du délai sans modification ; c'est sans conséquence ici puisque le contenu n'est pas modifié.

### Tester

1. Lancez l'app depuis Xcode sur un appareil réel (le simulateur reçoit les notifications depuis Xcode 14 sur Mac Apple Silicon), acceptez les notifications.
2. *Réglages → API → Appareils* : l'appareil apparaît avec l'étiquette « développement ».
3. *Envoyer un test* : une notification titrée « Midnights Monitoring », texte « Notification de test », arrive. En cas d'échec, la colonne *Dernier envoi* affiche l'erreur d'Apple (voir [Dépannage](#dépannage)).
4. Pour un vrai changement d'état, arrêtez l'agent d'un hôte (`sudo systemctl stop hlm-agent`) : après environ 3 intervalles d'agent puis la fenêtre de regroupement, la notification « Agent injoignable, l'hôte répond au ping » arrive.

## Widgets

### Cache partagé

Les widgets affichent la dernière réponse connue quand le hub est injoignable, plutôt qu'un widget vide.

```swift
// HubKit/WidgetCache.swift
import Foundation

public enum WidgetCache {
    public static func save(_ s: WidgetSummary) {
        // Le décodeur hub lit les dates en secondes : on encode de la même façon.
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970
        // Les CodingKeys ramènent les noms en snake_case : le cache a le format de l'API.
        HubStore.defaults.set(try? e.encode(s), forKey: "widgets")
    }

    public static func load() -> WidgetSummary? {
        HubStore.defaults.data(forKey: "widgets").flatMap { try? JSONDecoder.hub.decode(WidgetSummary.self, from: $0) }
    }
}
```

### Widget configurable

L'utilisateur choisit la vue en modifiant le widget : état général, problèmes en cours ou consommation.

```swift
// Widgets/HubWidget.swift
import WidgetKit
import SwiftUI
import AppIntents
import HubKit

enum WidgetView: String, AppEnum {
    case overview, problems, power
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Vue"
    static let caseDisplayRepresentations: [WidgetView: DisplayRepresentation] = [
        .overview: "Vue d'ensemble", .problems: "Problèmes", .power: "Consommation électrique",
    ]
}

struct HubWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Midnights Monitoring"
    static let description = IntentDescription("État du homelab, pannes en cours ou consommation.")
    @Parameter(title: "Vue", default: .overview) var view: WidgetView
}

struct HubEntry: TimelineEntry {
    let date: Date
    let view: WidgetView
    let summary: WidgetSummary?
    /// Affiché en petit quand les données viennent du cache.
    let stale: Bool
}

struct HubProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> HubEntry {
        HubEntry(date: .now, view: .overview, summary: nil, stale: false)
    }

    func snapshot(for configuration: HubWidgetIntent, in context: Context) async -> HubEntry {
        HubEntry(date: .now, view: configuration.view, summary: WidgetCache.load(), stale: false)
    }

    func timeline(for configuration: HubWidgetIntent, in context: Context) async -> Timeline<HubEntry> {
        var entry: HubEntry
        do {
            let s = try await Hub.shared.widgets()
            WidgetCache.save(s)
            entry = HubEntry(date: .now, view: configuration.view, summary: s, stale: false)
        } catch {
            entry = HubEntry(date: .now, view: configuration.view, summary: WidgetCache.load(), stale: true)
        }
        // Demande indicative : WidgetKit applique son propre budget de rafraîchissement.
        return Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60)))
    }
}

struct HubWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "fr.midnights.monitoring.hub", intent: HubWidgetIntent.self, provider: HubProvider()) { entry in
            HubWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Midnights Monitoring")
        .description("État du homelab, pannes en cours ou consommation électrique.")
        #if os(iOS)
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular])
        #else
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        #endif
    }
}
```

### Vues

```swift
struct HubWidgetView: View {
    let entry: HubEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let s = entry.summary {
            switch entry.view {
            case .overview: Overview(s: s)
            case .problems: Problems(s: s, limit: family == .systemLarge ? 6 : 3)
            case .power: Power(p: s.power)
            }
        } else {
            ContentUnavailableView("Hub non configuré", systemImage: "server.rack")
        }
    }
}

private struct Overview: View {
    let s: WidgetSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(s.status.label, systemImage: s.status.symbol).font(.headline)
            Text("\(s.hosts.total - s.hosts.down)/\(s.hosts.total) hôtes en ligne")
            Text("\(s.monitors.count(.operational))/\(s.monitors.total) sondes OK")
            if let w = s.power.nowW { Text("\(Int(w)) W").font(.title2.monospacedDigit()) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Problems: View {
    let s: WidgetSummary
    let limit: Int
    var body: some View {
        if s.problems.isEmpty {
            Label("Tout fonctionne", systemImage: "checkmark.circle.fill")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(s.problems.prefix(limit), id: \.self) { p in
                    HStack {
                        Image(systemName: p.status.symbol)
                        VStack(alignment: .leading) {
                            Text(p.name).font(.subheadline.bold())
                            Text(p.message).font(.caption2).lineLimit(1)
                        }
                        Spacer()
                        // Bouton interactif : voir la section suivante.
                        Button(intent: SetMaintenance(kind: p.kind == .host ? .host : .monitor, itemID: p.id, on: true)) {
                            Image(systemName: "wrench.and.screwdriver")
                        }
                    }
                }
            }
        }
    }
}

private struct Power: View {
    let p: WidgetSummary.Power
    var body: some View {
        VStack(alignment: .leading) {
            Text("Consommation").font(.caption)
            Text(p.nowW.map { "\(Int($0)) W" } ?? "—").font(.largeTitle.monospacedDigit())
            if let avg = p.avg24hW { Text("Moyenne 24 h : \(Int(avg)) W").font(.caption) }
            Text("\(p.plugs) prise(s)").font(.caption2).foregroundStyle(.secondary)
        }
    }
}
```

Pour un graphique de consommation sur plusieurs jours, appelez aussi `energy(days: 7)` dans `timeline(for:in:)` et tracez `days` / `plugs[].daily` avec Swift Charts (`BarMark`). Une moyenne en watts d'un jour s'obtient en divisant les Wh du jour par 24.

### Bonnes pratiques

- **Un seul appel réseau par rafraîchissement** : `/widgets` a été conçu pour ça. Évitez d'enchaîner `/hosts` et `/monitors` dans un widget.
- **Budget** : WidgetKit limite le nombre de rafraîchissements par jour (quelques dizaines par widget). `.after(15 min)` est une demande, pas une garantie. Les notifications (via l'extension) et l'ouverture de l'app (`WidgetCenter.shared.reloadAllTimelines()` quand `scenePhase` devient `.active`) gardent les widgets à jour entre deux créneaux.
- **Écran verrouillé** : le jeton est lisible après le premier déverrouillage (`AfterFirstUnlock`), ce qui suffit aux widgets.
- **Erreurs** : n'affichez pas d'alerte dans un widget ; montrez les données du cache avec un indicateur discret (`entry.stale`).

## Widgets interactifs et App Intents

Un bouton de widget exécute un `AppIntent` **dans le processus de l'extension de widgets** (d'où le trousseau partagé), puis WidgetKit recharge la timeline automatiquement.

```swift
// Widgets/Intents.swift (ajouté aussi à la cible App pour Raccourcis et Siri)
import AppIntents
import WidgetKit
import HubKit

enum MaintenanceTarget: String, AppEnum {
    case host, monitor
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Élément"
    static let caseDisplayRepresentations: [MaintenanceTarget: DisplayRepresentation] = [.host: "Hôte", .monitor: "Sonde"]
}

struct SetMaintenance: AppIntent {
    static let title: LocalizedStringResource = "Mettre en maintenance"
    static let description = IntentDescription("Active ou désactive la maintenance d'un hôte ou d'une sonde : plus d'alerte pendant une intervention.")

    @Parameter(title: "Type") var kind: MaintenanceTarget
    @Parameter(title: "Identifiant") var itemID: Int
    @Parameter(title: "Maintenance", default: true) var on: Bool

    init() {}
    init(kind: MaintenanceTarget, itemID: Int, on: Bool) {
        self.kind = kind
        self.itemID = itemID
        self.on = on
    }

    func perform() async throws -> some IntentResult {
        try await Hub.shared.setMaintenance(on, kind == .host ? .host : .monitor, id: itemID)
        return .result()
    }
}

/// Bouton « Actualiser » d'un widget : l'exécution d'un intent suffit à recharger la timeline.
struct RefreshHub: AppIntent {
    static let title: LocalizedStringResource = "Actualiser"
    static let isDiscoverable = false
    func perform() async throws -> some IntentResult { .result() }
}
```

```swift
Button(intent: RefreshHub()) { Image(systemName: "arrow.clockwise") }
    .buttonStyle(.plain)
```

- `maintenance:write` est indispensable au jeton pour ces boutons (sinon `403`, et le bouton ne fait rien de visible : prévoyez de masquer les boutons si `/hosts/{id}/maintenance` a déjà répondu `403`).
- Les mêmes intents apparaissent dans l'app **Raccourcis** et peuvent être déclenchés par Siri ou une automatisation (« mettre le NAS en maintenance à 3 h »). Pour qu'ils y apparaissent avec une liste d'hôtes plutôt qu'un identifiant, remplacez `itemID` par une `AppEntity` alimentée par `/hosts` (`EntityQuery`).
- Un widget n'a pas d'état local modifiable : après l'intent, la nouvelle timeline relit `/widgets`, qui reflète la maintenance (l'élément disparaît des problèmes).

## Préférences synchronisées

Les préférences sont un objet JSON stocké par le hub et partagé avec l'interface web (voir [la référence](API.md#get-apiv1preferences-et-put-apiv1preferences)). `PUT` fusionne par clé de premier niveau ; la dernière écriture d'une clé l'emporte.

| Clé | Partagée avec le web | Valeurs |
|---|---|---|
| `theme` | oui | `auto`, `light`, `dark` |
| `monitors_view` | oui | `cards`, `table` |
| `ios.*` (ex. `ios.home.sections`, `ios.widgets.default`) | non | libres, propres à l'app |

Préfixez les clés propres à l'app : le web les ignore, et elles ne risquent pas d'entrer en collision avec une future clé du web.

```swift
// App/PreferencesStore.swift
import SwiftUI
import HubKit

enum ThemeChoice: String, CaseIterable {
    case auto, light, dark
    var colorScheme: ColorScheme? { self == .light ? .light : self == .dark ? .dark : nil }
}

@MainActor @Observable
final class PreferencesStore {
    private(set) var values: Preferences = HubStore.cachedPreferences

    var theme: ThemeChoice {
        get { values["theme"]?.string.flatMap { ThemeChoice(rawValue: $0) } ?? .auto }
        set { set("theme", .string(newValue.rawValue)) }
    }

    /// À appeler au lancement et quand l'app revient au premier plan.
    func refresh() async {
        guard let p = try? await Hub.shared.preferences() else { return } // hors ligne : on garde le cache
        apply(p)
    }

    /// Mise à jour optimiste, puis valeur renvoyée par le hub (qui inclut les changements faits ailleurs).
    func set(_ key: String, _ value: JSONValue) {
        values[key] = value
        Task {
            if let p = try? await Hub.shared.updatePreferences([key: value]) { apply(p) }
        }
    }

    func remove(_ key: String) { set(key, .null) }

    private func apply(_ p: Preferences) {
        values = p
        HubStore.cachedPreferences = p
    }
}

extension HubStore {
    static var cachedPreferences: Preferences {
        get { defaults.data(forKey: "preferences").flatMap { try? JSONDecoder().decode(Preferences.self, from: $0) } ?? [:] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "preferences") }
    }
}
```

```swift
struct RootView: View {
    @State private var prefs = PreferencesStore()
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ContentView()
            .environment(prefs)
            .preferredColorScheme(prefs.theme.colorScheme)
            .onChange(of: phase) { _, p in
                if p == .active { Task { await prefs.refresh() } }
            }
            .task { await prefs.refresh() }
    }
}
```

- Le web relit les préférences à chaque ouverture et les enregistre à chaque changement de thème ou de vue : un changement fait sur l'iPhone apparaît au prochain chargement du web, et inversement au retour de l'app au premier plan.
- Les préférences sont **communes à tous les utilisateurs du hub** et à tous les appareils : n'y mettez rien de propre à un seul appareil (gardez cela dans les `UserDefaults` locaux).
- Les réglages du serveur (SMTP, rétention, fenêtre de regroupement…) ne sont pas exposés par l'API : ils se modifient dans l'interface web.

## Rafraîchissement des données

| Contexte | Fréquence conseillée | Route |
|---|---|---|
| Écran principal ouvert | 30 s (`.task` + `Task.sleep`) | `/widgets` ou `/status`, puis `/hosts` et `/monitors` à la demande |
| Écran d'un hôte | 30 s | `/hosts/{id}`, graphique `/hosts/{id}/metrics?range=…` à l'ouverture |
| Retour au premier plan | une fois | `/widgets`, `/preferences`, rechargement des widgets |
| Arrière-plan (iOS) | laissé à iOS (`BGAppRefreshTask`) | `/widgets`, puis `WidgetCenter.shared.reloadAllTimelines()` |
| Widgets | 15 min demandées | `/widgets` |

Les agents remontent leurs mesures toutes les 30 secondes par défaut : interroger plus souvent n'apporte rien. La limite de 600 requêtes par minute et par jeton est très loin de ces usages ; un `429` signale une boucle à corriger.

```swift
// Rafraîchissement d'un écran tant qu'il est visible ; la tâche s'annule quand la vue disparaît.
.task {
    while !Task.isCancelled {
        await model.load()
        try? await Task.sleep(for: .seconds(30))
    }
}
```

## Sécurité

- **Un jeton par appareil**, avec les seuls scopes utilisés, une expiration (1 an par exemple) et un nom explicite (« iPhone de … »). Révoquer le jeton coupe l'accès **et** désinscrit l'appareil des notifications.
- **Trousseau uniquement**, avec `AfterFirstUnlockThisDeviceOnly` : pas de jeton dans `UserDefaults`, les fichiers de l'App Group, les journaux ou les rapports de plantage.
- **HTTPS** avec un certificat valide. Ne désactivez pas la validation TLS (`URLSessionDelegate` qui accepte tout) : préférez un certificat Let's Encrypt sur le reverse proxy.
- **Pas de CORS nécessaire** : une app native n'est pas un navigateur, laissez *Origines autorisées* vide pour elle.
- **Données de la notification** : le titre et le texte s'affichent sur l'écran verrouillé et peuvent contenir des noms d'hôtes et des messages d'erreur. L'utilisateur peut masquer les aperçus dans les réglages de notification d'iOS / macOS.
- **Clé APNs** : elle permet d'envoyer des notifications à toutes vos apps. Gardez-la en lecture seule pour l'utilisateur du serveur, hors du dépôt Git, et révoquez-la dans le compte développeur en cas de fuite.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « APNs non configuré » dans *Réglages → API* | variable `HLT_APNS_*` manquante, ou clé illisible | vérifier les quatre variables et le journal du serveur (`APNs key: …`), redémarrer |
| *Dernier envoi* : `APNs 403 InvalidProviderToken` | Key ID ou Team ID incorrect | corriger `HLT_APNS_KEY_ID` / `HLT_APNS_TEAM_ID` |
| `APNs 400 BadDeviceToken` (appareil retiré) | environnement inversé : build Xcode inscrit en production, ou TestFlight en `sandbox` | vérifier la valeur `sandbox` envoyée par l'app ; l'app se réinscrit au lancement suivant |
| `APNs 400 DeviceTokenNotForTopic` (appareil retiré) | `HLT_APNS_TOPIC` différent du bundle id de l'app | aligner les deux (attention au préfixe `maccatalyst.`) |
| `APNs 400 TopicDisallowed` | la clé n'est pas autorisée pour cette app | clé créée dans un autre compte développeur, ou App ID sans *Push Notifications* |
| `APNs 410 Unregistered` (appareil retiré) | app désinstallée ou notifications désactivées | normal ; l'appareil se réinscrit s'il réactive les notifications |
| Aucune notification, aucune erreur | aucun changement d'état, ou appareil inscrit avec un autre jeton révoqué depuis | *Envoyer un test* ; vérifier la liste des appareils |
| Notification de panne en retard | regroupement (60 s par défaut) + seuil d'échecs des sondes + 3 intervalles d'agent pour un hôte | réduire la *Fenêtre de regroupement* (*Réglages → Notifications par e-mail*) ou l'intervalle des sondes |
| `401` partout | jeton révoqué ou expiré | redemander un jeton à l'utilisateur |
| `404` sur toutes les routes | API désactivée, ou URL qui pointe vers Midnights Management | activer l'API ; utiliser l'adresse du monitoring |
| `403` sur une route | scope manquant | ajouter le scope dans un nouveau jeton (les scopes d'un jeton ne se modifient pas) |
| Widget vide ou « Hub non configuré » | jeton non lisible par l'extension | même groupe Keychain Sharing et même App Group sur les trois cibles ; `kSecUseDataProtectionKeychain` sur macOS |
| Erreur de décodage sur `by_status` ou les préférences | `convertFromSnakeCase` activé | utiliser `JSONDecoder.hub` et les `CodingKeys` de ce guide |
| Erreur réseau sur un hub local en HTTP | App Transport Security ou autorisation *Réseau local* refusée | HTTPS ; sinon `NSAllowsLocalNetworking` et `NSLocalNetworkUsageDescription` |

## Liste de contrôle avant publication

- [ ] Le hub est joignable en HTTPS depuis l'extérieur (4G, autre réseau).
- [ ] Les quatre variables `HLT_APNS_*` sont définies ; *Envoyer un test* fonctionne avec un build TestFlight (environnement de production).
- [ ] Même bundle id pour iOS et macOS, égal à `HLT_APNS_TOPIC`.
- [ ] App, widgets et extension de notification partagent l'App Group et le groupe Keychain Sharing.
- [ ] Le jeton est stocké dans le trousseau avec `AfterFirstUnlockThisDeviceOnly`.
- [ ] Les écrans dépendant d'un scope se masquent sur `403` au lieu d'afficher une erreur.
- [ ] Déconnexion : `DELETE /devices/{token}` puis effacement du trousseau.
- [ ] Les widgets affichent le cache quand le hub est injoignable.
- [ ] Les clés de préférences propres à l'app sont préfixées `ios.`.
- [ ] *Time Sensitive Notifications* est activé si vous voulez que les pannes passent les modes Concentration.
