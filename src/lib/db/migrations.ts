/**
 * Migrations SQL appliquées dans l'ordre au démarrage.
 * Ne jamais modifier une migration publiée : en ajouter une nouvelle.
 */
export const migrations: string[] = [
  /* 001 — schéma initial */
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,             -- sha256 du jeton
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Réseau / IPAM -----------------------------------------------------------
  CREATE TABLE vlans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    vlan_id     INTEGER NOT NULL UNIQUE CHECK (vlan_id BETWEEN 1 AND 4094),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT 'accent',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE subnets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    cidr        TEXT NOT NULL UNIQUE,
    vlan_id     INTEGER REFERENCES vlans(id) ON DELETE SET NULL,
    gateway     TEXT NOT NULL DEFAULT '',
    dns         TEXT NOT NULL DEFAULT '',
    dhcp_start  TEXT NOT NULL DEFAULT '',
    dhcp_end    TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Inventaire --------------------------------------------------------------
  CREATE TABLE assets (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    kind                TEXT NOT NULL CHECK (kind IN ('physical','vm','lxc','docker','network','other')),
    display_name        TEXT NOT NULL,
    hostname            TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'online'
                        CHECK (status IN ('online','offline','maintenance','planned','decommissioned')),
    role                TEXT NOT NULL DEFAULT '',
    description         TEXT NOT NULL DEFAULT '',
    tags                TEXT NOT NULL DEFAULT '[]',
    parent_id           INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    os                  TEXT NOT NULL DEFAULT '',
    os_version          TEXT NOT NULL DEFAULT '',
    location            TEXT NOT NULL DEFAULT '',
    -- Matériel
    manufacturer        TEXT NOT NULL DEFAULT '',
    model               TEXT NOT NULL DEFAULT '',
    serial_number       TEXT NOT NULL DEFAULT '',
    cpu_model           TEXT NOT NULL DEFAULT '',
    cpu_sockets         INTEGER,
    cpu_cores           INTEGER,
    cpu_threads         INTEGER,
    ram_gb              REAL,
    ram_type            TEXT NOT NULL DEFAULT '',
    gpu                 TEXT NOT NULL DEFAULT '',
    disks               TEXT NOT NULL DEFAULT '[]',   -- [{name,type,capacity_gb,usage}]
    nics                TEXT NOT NULL DEFAULT '[]',   -- [{name,mac,speed}]
    power_watts         INTEGER,
    -- Logiciel / plateforme
    management_url      TEXT NOT NULL DEFAULT '',
    docker_image        TEXT NOT NULL DEFAULT '',
    docker_ports        TEXT NOT NULL DEFAULT '',
    docker_compose      TEXT NOT NULL DEFAULT '',
    proxmox_integration_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
    proxmox_node        TEXT NOT NULL DEFAULT '',
    proxmox_vmid        INTEGER,
    notes               TEXT NOT NULL DEFAULT '',
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX assets_kind ON assets(kind);
  CREATE INDEX assets_parent ON assets(parent_id);

  CREATE TABLE ip_addresses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    address     TEXT NOT NULL,
    subnet_id   INTEGER REFERENCES subnets(id) ON DELETE SET NULL,
    asset_id    INTEGER REFERENCES assets(id) ON DELETE CASCADE,
    mac         TEXT NOT NULL DEFAULT '',
    hostname    TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'used' CHECK (status IN ('used','reserved','dhcp','free')),
    is_primary  INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX ip_addresses_address ON ip_addresses(address);
  CREATE INDEX ip_addresses_asset ON ip_addresses(asset_id);
  CREATE INDEX ip_addresses_subnet ON ip_addresses(subnet_id);

  -- Déploiements ------------------------------------------------------------
  CREATE TABLE deployments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('physical','vm','lxc','docker','application','other')),
    status          TEXT NOT NULL DEFAULT 'planned'
                    CHECK (status IN ('planned','preparing','in_progress','testing','blocked','done','cancelled')),
    priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
    description     TEXT NOT NULL DEFAULT '',
    target_host_id  INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    asset_id        INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    planned_cpu     INTEGER,
    planned_ram_gb  REAL,
    planned_disk_gb REAL,
    planned_ip      TEXT NOT NULL DEFAULT '',
    subnet_id       INTEGER REFERENCES subnets(id) ON DELETE SET NULL,
    target_date     TEXT,
    notes           TEXT NOT NULL DEFAULT '',
    tags            TEXT NOT NULL DEFAULT '[]',
    completed_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE deployment_steps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id INTEGER NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    label         TEXT NOT NULL,
    done          INTEGER NOT NULL DEFAULT 0,
    position      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX deployment_steps_deployment ON deployment_steps(deployment_id);

  -- Tâches ------------------------------------------------------------------
  CREATE TABLE tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done')),
    priority      TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
    due_date      TEXT,
    tags          TEXT NOT NULL DEFAULT '[]',
    asset_id      INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    deployment_id INTEGER REFERENCES deployments(id) ON DELETE SET NULL,
    position      INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Page d'accueil ----------------------------------------------------------
  CREATE TABLE shortcut_groups (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE shortcuts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    group_id     INTEGER REFERENCES shortcut_groups(id) ON DELETE SET NULL,
    icon_type    TEXT NOT NULL DEFAULT 'none' CHECK (icon_type IN ('none','dashboard','selfhst','upload','url')),
    icon_value   TEXT NOT NULL DEFAULT '',
    asset_id     INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    new_tab      INTEGER NOT NULL DEFAULT 1,
    status_check INTEGER NOT NULL DEFAULT 1,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE uploaded_icons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT NOT NULL UNIQUE,
    label      TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Intégrations (Proxmox, Beszel, Maintenant, PatchMon) ---------------------
  CREATE TABLE integrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL CHECK (type IN ('proxmox','beszel','maintenant','patchmon')),
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    config     TEXT NOT NULL DEFAULT '',     -- JSON chiffré (AES-256-GCM)
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Carte -------------------------------------------------------------------
  CREATE TABLE map_positions (
    asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    x        REAL NOT NULL,
    y        REAL NOT NULL
  );

  CREATE TABLE map_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id  INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    target_id  INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'ethernet' CHECK (kind IN ('ethernet','fiber','wifi','vpn','logical')),
    label      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (source_id, target_id)
  );

  -- Journal d'activité ------------------------------------------------------
  CREATE TABLE activity (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id   INTEGER,
    action      TEXT NOT NULL,
    summary     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX activity_created ON activity(created_at DESC);
  `,

  /* 002 — déploiements : VMID, apps déployées, sous-domaines */
  `
  ALTER TABLE deployments ADD COLUMN vmid INTEGER;
  ALTER TABLE deployments ADD COLUMN apps TEXT NOT NULL DEFAULT '';
  ALTER TABLE deployments ADD COLUMN local_fqdn TEXT NOT NULL DEFAULT '';
  ALTER TABLE deployments ADD COLUMN public_fqdn TEXT NOT NULL DEFAULT '';
  `,

  /* 003 — tunnels VPN, règles de pare-feu (simulation de flux) */
  `
  CREATE TABLE vpn_tunnels (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    type             TEXT NOT NULL CHECK (type IN ('wireguard','tailscale','headscale','netbird','zerotier','openvpn','ipsec','other')),
    status           TEXT NOT NULL DEFAULT 'up' CHECK (status IN ('up','down','planned')),
    endpoint_a_id    INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    endpoint_b_id    INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    endpoint_b_label TEXT NOT NULL DEFAULT '',
    tunnel_cidr      TEXT NOT NULL DEFAULT '',
    ip_a             TEXT NOT NULL DEFAULT '',
    ip_b             TEXT NOT NULL DEFAULT '',
    routes_a         TEXT NOT NULL DEFAULT '[]',
    routes_b         TEXT NOT NULL DEFAULT '[]',
    listen_port      INTEGER,
    public_endpoint  TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE firewall_rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    position   INTEGER NOT NULL DEFAULT 0,
    name       TEXT NOT NULL DEFAULT '',
    enabled    INTEGER NOT NULL DEFAULT 1,
    action     TEXT NOT NULL CHECK (action IN ('allow','deny')),
    src_type   TEXT NOT NULL CHECK (src_type IN ('any','vlan','subnet','asset','cidr','vpn','internet')),
    src_value  TEXT NOT NULL DEFAULT '',
    dst_type   TEXT NOT NULL CHECK (dst_type IN ('any','vlan','subnet','asset','cidr','vpn','internet')),
    dst_value  TEXT NOT NULL DEFAULT '',
    protocol   TEXT NOT NULL DEFAULT 'any' CHECK (protocol IN ('any','tcp','udp','icmp')),
    ports      TEXT NOT NULL DEFAULT '',
    notes      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,

  /* 004 — sondes de disponibilité (temps de réponse, uptime, incidents) */
  `
  CREATE TABLE monitors (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('http','tcp')),
    target       TEXT NOT NULL,
    interval_sec INTEGER NOT NULL DEFAULT 60,
    timeout_ms   INTEGER NOT NULL DEFAULT 5000,
    accept       TEXT NOT NULL DEFAULT 'lt500' CHECK (accept IN ('2xx3xx','lt500')),
    verify_tls   INTEGER NOT NULL DEFAULT 0,
    enabled      INTEGER NOT NULL DEFAULT 1,
    asset_id     INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE monitor_checks (
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    ts         INTEGER NOT NULL,          -- epoch ms
    up         INTEGER NOT NULL,
    ms         INTEGER,
    status     INTEGER,
    error      TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX monitor_checks_ts ON monitor_checks(monitor_id, ts);

  CREATE TABLE monitor_daily (
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    day        TEXT NOT NULL,             -- AAAA-MM-JJ (UTC)
    checks     INTEGER NOT NULL DEFAULT 0,
    ups        INTEGER NOT NULL DEFAULT 0,
    sum_ms     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (monitor_id, day)
  );
  `,

  /* 005 — Webmin + clés SSH (reconstruction de « integrations » pour étendre le CHECK) */
  `
  CREATE TABLE ssh_keys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
    type        TEXT NOT NULL,
    public_key  TEXT NOT NULL,
    private_key TEXT NOT NULL,             -- chiffrée (AES-256-GCM)
    fingerprint TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE integrations_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL CHECK (type IN ('proxmox','beszel','maintenant','patchmon','webmin')),
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    config     TEXT NOT NULL DEFAULT '',
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO integrations_new SELECT id, type, name, url, config, enabled, created_at, updated_at FROM integrations;
  DROP TABLE integrations;
  ALTER TABLE integrations_new RENAME TO integrations;
  `,

  /* 006 — passkeys (WebAuthn) */
  `
  CREATE TABLE passkeys (
    id           TEXT PRIMARY KEY,           -- identifiant de la credential (base64url)
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key   BLOB NOT NULL,              -- clé COSE
    counter      INTEGER NOT NULL DEFAULT 0,
    transports   TEXT NOT NULL DEFAULT '',
    name         TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );
  CREATE INDEX passkeys_user ON passkeys(user_id);
  `,

  /* 007 — état réel des actifs (détection automatique) */
  `
  ALTER TABLE assets ADD COLUMN status_source TEXT NOT NULL DEFAULT '';
  ALTER TABLE assets ADD COLUMN status_checked_at TEXT;
  `,

  /* 008 — Homelab Monitoring (reconstruction de « integrations » pour étendre le CHECK) */
  `
  CREATE TABLE integrations_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    type       TEXT NOT NULL CHECK (type IN ('proxmox','beszel','maintenant','patchmon','webmin','hlm')),
    name       TEXT NOT NULL,
    url        TEXT NOT NULL,
    config     TEXT NOT NULL DEFAULT '',
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO integrations_new SELECT id, type, name, url, config, enabled, created_at, updated_at FROM integrations;
  DROP TABLE integrations;
  ALTER TABLE integrations_new RENAME TO integrations;
  `,

  /* 009 — noms de domaine pointant vers le reverse proxy */
  `
  CREATE TABLE domains (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fqdn            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    exposure        TEXT NOT NULL CHECK (exposure IN ('public','lan')),
    proxy_asset_id  INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    target_asset_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    upstream        TEXT NOT NULL DEFAULT '',  -- URL interne du service (http://10.0.10.5:8096)
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
];
