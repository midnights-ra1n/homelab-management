# Homelab Management

> [!NOTE]
> **Personal project, built with the help of AI.** This application was designed and written with an AI assistant
> (Claude, by Anthropic) for my own homelab. It is shared as-is, without warranty or support: read the code and test
> it before relying on it, especially the Proxmox actions (start, stop, migration) and exposing it on a network.

> [!TIP]
> **Want to use it for your own homelab? Fork it.** The recommended path is to fork this repository, adapt it to your
> needs and build your own Docker image (the included GitHub Actions workflow publishes it to your fork's GHCR), rather
> than opening pull requests here. This project follows my own setup and priorities, so contributions may not be
> merged; a fork gives you full control over updates, features and security fixes.

Self-hosted web application to run a homelab: inventory, IPAM, deployments, tasks, start page, interactive map,
multi-node Proxmox management, Webmin instances and centralized monitoring (Beszel, Maintenant, PatchMon).

Available in **French and English** (switch in the user menu, the settings or the sign-in page).

Design: **Midnights Mint** style guide ([noe-georget.fr/graphique](https://noe-georget.fr/graphique)) — accent `#3fbfa6`,
Geist & Geist Mono fonts (`geist` npm package), dark / light / auto themes.

## Features

| Module | Contents |
| --- | --- |
| **Dashboard** | KPIs, live Proxmox status and monitoring alerts, deployments in progress, upcoming tasks, hardware capacity, IPAM usage, activity log |
| **Applications** | Grouped shortcuts, search (`/`, Enter to open), availability check, [Dashboard Icons](https://dashboardicons.com) / [selfh.st](https://selfh.st/icons) icons, custom icon upload or URL, drag-and-drop reordering |
| **Inventory** | Physical servers, VMs, LXC CTs, Docker containers, network devices. Display name + hostname, IP/VLAN/subnet, tags, parent host, hardware (CPU, sockets/cores/threads, RAM + type, GPU, disks, NICs, power draw), OS, Proxmox, Docker, notes. Automatic matching with Beszel / PatchMon |
| **Network (IPAM)** | VLANs, subnets (gateway, DNS, DHCP range), clickable usage grid, next free IP, conflict detection, VPN tunnels, firewall rules and packet-flow simulation |
| **Deployments** | Manual tracking: type, status, priority, target, VMID, containers/apps, subdomains, checklist (templates per type), notes. **Cards** or **List** view; one-click creation of the inventory item |
| **Tasks** | Drag-and-drop (and keyboard) Kanban, priorities, due dates, links to inventory / deployments |
| **Map** | React Flow topology: host → guests hierarchy, physical/logical links, type / VLAN filters, saved positions |
| **Proxmox** | Aggregates standalone nodes (no cluster, no PDM): resources, guests, start/stop/reboot, task log, storage, **remote migration** (`remote-migrate`), sync to the inventory |
| **Webmin** | All your Webmin instances on one page: web UI reachability plus, over key-based SSH, OS, uptime, load, memory, disk, Webmin version and service status, pending updates and reboot-required flag |
| **Monitoring** | Built-in availability probes (HTTP/TCP), status-page style: global status, response time (24 h / 7 d / 30 d), 90-day availability bars, incidents (outage confirmed after 2 failures). Plus Beszel, Maintenant and PatchMon |
| **Settings** | Integrations (with connection test), SSH keys, theme, language, password, JSON export / restore |

## Mobile & PWA

- Installable (manifest, icons, shortcuts): *Add to Home Screen* on iOS / Android, or *Install* on desktop.
- Bottom tab bar (thumb zone), sliding "More" sheet, sheet dialogs on mobile, tables shown as cards.
- Service worker: static assets cached, offline page when the server is unreachable (no data is cached).
- Respects safe areas (notch, home bar) and the "reduce motion" preference.

> PWA installation requires HTTPS (or `localhost`): serve it through your reverse proxy with a certificate.

## Quick start

### Docker / Podman

```bash
docker compose up -d
# → http://<host>:3000 : the first visit offers to create the admin account
```

Data (SQLite database, uploaded icons, encryption key) lives in the `/data` volume.

### Your own image (recommended for a fork)

```bash
docker build -t homelab-management .
```

Or push to your fork's `stable` branch: the GitHub Actions workflow builds a multi-arch (amd64 + arm64) image on
native runners and publishes it to `ghcr.io/<your-account>/homelab-management`. Update `image:` in `compose.yaml`
accordingly.

### Proxmox CT from an OCI image (PVE 9.1+)

The image is published with OCI media types and no attestation manifests, so Proxmox can pull it directly:
*Storage → CT Templates → Pull from OCI registry* → `ghcr.io/midnights-ra1n/homelab-management:latest`.

To upload an archive instead, export it in OCI layout:

```bash
docker buildx build --platform linux/amd64 --output type=oci,dest=homelab-management.tar .
```

Create the CT from the template, add a mount point on `/data` and open port `3000`. The image is built for this:
`tini` is PID 1 (clean CT shutdown), the entrypoint gives `/data` to the `app` user (UID 1001) even when Proxmox
creates the mount point as root, then drops root privileges. Environment variables (`APP_SECRET`,
`COOKIE_SECURE`…) can be set in the CT *Options*.

### Development

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test && pnpm lint && pnpm build
```

Requirements: Node.js ≥ 22.13 (uses the built-in `node:sqlite` module, no native dependency to compile).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | `./data` (`/data` in the image) | SQLite database, icons, key |
| `APP_SECRET` | generated in `DATA_DIR/secret.key` | AES-256-GCM encryption key for integration secrets and SSH keys |
| `COOKIE_SECURE` | `false` | `Secure` session cookie (behind HTTPS) |
| `AUTH_DISABLED` | `false` | Disables the built-in sign-in (only behind an SSO) |
| `MONITOR_DISABLED` | `false` | Disables the background availability monitor |
| `PORT` / `TZ` | `3000` / `Europe/Paris` | |

## Integrations

- **Proxmox VE** — one integration per node. API token (*Datacenter → Permissions → API Tokens*): `PVEAuditor` is
  enough for read access, `PVEVMAdmin` for actions. For remote migration, the target token needs `Sys.Incoming`.
  Disable TLS verification for the self-signed certificate.
- **Beszel** — hub URL + a user's e-mail / password (PocketBase API).
- **Maintenant** — URL; no built-in auth, an optional header lets you get through the reverse proxy.
- **PatchMon** — *Integration API* credentials with the `host:get` scope (Basic auth).
- **Webmin** — one integration per instance: the Webmin URL, plus optionally an SSH key, user and port. Create or
  import the key in *Settings → SSH keys* (Ed25519 recommended), then add its public key to the user's
  `~/.ssh/authorized_keys` on each host. Everything is read-only, so a non-root account is enough. The host key
  fingerprint is pinned on first connection (trust on first use); a changed fingerprint is refused until you reset it.

Secrets and private keys are encrypted in the database and never sent to the browser.

## Languages

The interface is French by default and fully translated into English. The language is picked from the `hm-lang`
cookie (set by the switcher), otherwise from the browser's `Accept-Language`. URLs stay the same: the proxy rewrites
each page to its prerendered `/fr/…` or `/en/…` version.

Translations live in `src/i18n/en.ts`, keyed by the French source text (gettext style). A missing entry falls back
to French, and a test fails if a French string passed to `tr()` has no English translation.

## Security

- **WAF** (`src/lib/security.ts`, applied by `src/proxy.ts`): returns 403 for SQL injection, XSS, path traversal,
  Log4Shell / command injection and CRLF signatures, known scanners (`sqlmap`, `nikto`, `nuclei`…), common probes
  (`/.env`, `/.git`, `/wp-login.php`, `*.php`…) and unusual HTTP methods. The URL and User-Agent are inspected, not
  form bodies (protected by parameterized SQL, zod and React escaping).
- **Brute-force protection**: 10 failures on a username → 15 s lock, doubled on each new failure (max 5 min);
  25 failures from an IP → IP banned from the whole app (30 s doubled, max 10 min). 15 WAF hits → IP banned for 60 s
  (doubled, max 30 min). Response `429` + `Retry-After`. Events are logged (`[auth]`, `[waf]`) for fail2ban / CrowdSec.
- **Passkeys** (WebAuthn, HTTPS only): add them in *Settings → Account*, then use “Sign in with a passkey”.
  User verification (biometrics / PIN) is required; failures count toward the IP ban. A passkey is bound to the
  hostname it was created on.
- **Headers**: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP.
- The client IP is the last entry of `X-Forwarded-For`. **Run the app behind a reverse proxy** that sets this header:
  when exposed directly, the IP can be spoofed and only the per-username lock protects the sign-in.
- Counters are kept in memory: a restart resets them.

## Architecture

```
src/
  app/[lang]/(auth)  sign-in, first start
  app/[lang]/(app)   pages (dashboard, inventory, network, Webmin, …)
  app/api            health, export, uploaded icons
  actions/           server actions (zod validation, session required)
  i18n/              translator, English dictionary, locale provider
  lib/db             SQLite (node:sqlite) + migrations
  lib/data           data access per domain
  lib/integrations   Proxmox, Beszel, Maintenant, PatchMon, Webmin (SSH) clients
  components/        style-guide UI (buttons, fields, cards, dialogs…)
  features/          feature components per module
```

Stack: Next.js 16 (App Router, Cache Components, React Compiler), React 19, Tailwind CSS 4, zod, React Flow, ssh2, lucide.
