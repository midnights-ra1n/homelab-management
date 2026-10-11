# Graph Report - homelab-management  (2026-10-11)

## Corpus Check
- 184 files · ~97,533 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 5 file(s) not represented in the graph (top: (none) 3, .example 1, .css 1)

## Summary
- 1169 nodes · 5016 edges · 53 communities (47 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 29 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- UI Kit & Auth Forms
- Uptime Probes & Monitors
- App Shell & Layout
- Deployment Detail UI
- Map & Edit Forms
- App Shortcuts & Icons
- List Pages
- Deployments Data & Actions
- Validation Schemas
- CRUD Server Actions
- Storage, Backup & Uploads
- Dashboard Widgets
- IPAM Subnets & IPs
- Proxmox Multi-node Actions
- Monitoring & App Pages
- IP Math & Rule Engine
- SSH & Integration Secrets
- API Routes & Auth Pages
- Beszel Integration
- WAF & Locale Proxy
- Network Page UI
- TypeScript Config
- Inventory Forms & Tables
- CI & Container Release
- Kind Icons & Map Nodes
- IP Grid & Constants
- Package Manifest
- Integration Config
- Authentication
- Homelab Map Editing
- HTTP Client & Maintenant
- Asset Detail Page
- Tasks Kanban
- Root Layout & PWA
- i18n Translation
- Inventory Actions
- Firewall Rules
- SSH Key Management
- Runtime Dependencies
- Dev Dependencies
- README Feature Modules
- Task Actions
- VPN Tunnels
- npm Scripts
- ESLint Config
- Security Headers & CSP
- Security Hardening Docs
- Next.js Agent Notice
- Applications Start Page
- i18n Docs

## God Nodes (most connected - your core abstractions)
1. `requireUser()` - 118 edges
2. `cn()` - 110 edges
3. `useT()` - 108 edges
4. `getT` - 103 edges
5. `run()` - 91 edges
6. `react` - 71 edges
7. `get()` - 66 edges
8. `next` - 60 edges
9. `all()` - 58 edges
10. `logActivity()` - 51 edges

## Surprising Connections (you probably didn't know these)
- `robots.txt (disallow all)` --semantically_similar_to--> `WAF (src/lib/security.ts via src/proxy.ts)`  [INFERRED] [semantically similar]
  public/robots.txt → README.md
- `homelab compose service` --references--> `GitHub Container Registry (ghcr.io)`  [EXTRACTED]
  compose.yaml → .github/workflows/docker.yml
- `Offline fallback page` --implements--> `Midnights Mint style guide (accent #3fbfa6, Geist)`  [INFERRED]
  public/offline.html → README.md
- `PWA & service worker (offline page)` --references--> `Offline fallback page`  [INFERRED]
  README.md → public/offline.html
- `generateMetadata()` --calls--> `getT`  [EXTRACTED]
  src/app/[lang]/(app)/carte/page.tsx → src/i18n/server.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Centralized monitoring integrations** — readme_monitoring, readme_beszel, readme_maintenant, readme_patchmon [EXTRACTED 1.00]
- **Container image build and deployment** — _github_workflows_docker, _github_workflows_docker_ghcr, compose_homelab_service, readme_proxmox_oci_ct [INFERRED 0.85]
- **Application security hardening** — readme_waf, readme_bruteforce_protection, readme_secret_encryption [EXTRACTED 1.00]

## Communities (53 total, 6 thin omitted)

### Community 0 - "UI Kit & Auth Forms"
Cohesion: 0.07
Nodes (92): lucide-react, react, LoginForm(), SetupForm(), Alert(), KINDS, Button(), buttonClass() (+84 more)

### Community 1 - "Uptime Probes & Monitors"
Cohesion: 0.06
Nodes (76): server-only, undici, deleteMonitorAction(), importMonitorsAction(), refresh(), runMonitorNowAction(), saveMonitorAction(), toggleMonitorAction() (+68 more)

### Community 2 - "App Shell & Layout"
Cohesion: 0.07
Nodes (53): logoutAction(), AppLayout(), AuthLayout(), AlertBanner(), AlertStrip(), summary(), useAlerts(), AmbientGlow() (+45 more)

### Community 3 - "Deployment Detail UI"
Cohesion: 0.10
Nodes (39): setDeploymentStatusAction(), DeploymentPage(), Detail(), generateMetadata(), Row(), Badge(), Tag(), meterTone() (+31 more)

### Community 4 - "Map & Edit Forms"
Cohesion: 0.10
Nodes (37): generateMetadata(), MapPage(), MapView(), deploymentFormOptions(), Edit(), EditDeploymentPage(), generateMetadata(), Form() (+29 more)

### Community 5 - "App Shortcuts & Icons"
Cohesion: 0.11
Nodes (40): ALLOWED, deleteGroupAction(), deleteShortcutAction(), deleteUploadedIconAction(), listUploadedIconsAction(), moveGroupAction(), probeShortcutsAction(), refresh() (+32 more)

### Community 6 - "List Pages"
Cohesion: 0.14
Nodes (27): next, Deployments(), DeploymentsPage(), generateMetadata(), Inventory(), InventoryPage(), Overview(), ProxmoxPage() (+19 more)

### Community 7 - "Deployments Data & Actions"
Cohesion: 0.16
Nodes (33): addStepAction(), deleteDeploymentAction(), deleteStepAction(), promoteDeploymentAction(), saveDeploymentAction(), toggleStepAction(), GET(), logActivity() (+25 more)

### Community 8 - "Validation Schemas"
Cohesion: 0.06
Nodes (31): isValidPortSpec(), blankToNull(), checkbox, cidrList, DeploymentInput, deploymentSchema, diskSchema, groupSchema (+23 more)

### Community 9 - "CRUD Server Actions"
Cohesion: 0.19
Nodes (31): deleteIntegrationAction(), saveAssetAction(), checkIpAction(), deleteIpAction(), deleteRuleAction(), deleteSubnetAction(), deleteVlanAction(), deleteVpnAction() (+23 more)

### Community 10 - "Storage, Backup & Uploads"
Cohesion: 0.14
Nodes (20): importBackupAction(), GET(), IMAGE_MIME, decrypt(), encrypt(), key(), Backup, importBackup() (+12 more)

### Community 11 - "Dashboard Widgets"
Cohesion: 0.22
Nodes (26): LiveMonitoring(), CapacityWidget(), Dashboard(), DashboardAlertBanner(), dashboardAlerts, DashboardPage(), DashboardSkeleton(), DeploymentsWidget() (+18 more)

### Community 12 - "IPAM Subnets & IPs"
Cohesion: 0.18
Nodes (25): RFC-1918, attachOrphanIps(), createIp(), createSubnet(), findSubnetFor(), getSubnet(), ipamTotals(), IpConflictError (+17 more)

### Community 13 - "Proxmox Multi-node Actions"
Cohesion: 0.18
Nodes (22): guestActionAction(), integrationOrThrow(), migrationTargetsAction(), nodeTasksAction(), remoteMigrateAction(), Result, syncProxmoxInventoryAction(), IntegrationError (+14 more)

### Community 14 - "Monitoring & App Pages"
Cohesion: 0.17
Nodes (24): ApplicationsPage(), Apps(), generateMetadata(), generateMetadata(), generateMetadata(), BeszelSection(), containerTone(), generateMetadata() (+16 more)

### Community 15 - "IP Math & Rule Engine"
Cohesion: 0.19
Nodes (23): cidrContains(), isIpv4(), isPrivateIp(), portMatches(), assetByIp(), checkIp(), evaluateRules(), Hop (+15 more)

### Community 16 - "SSH & Integration Secrets"
Cohesion: 0.14
Nodes (16): ssh2, rememberHostKey(), getPrivateKey(), probeUrl(), sshExec(), SshTarget, num(), parseSystem() (+8 more)

### Community 17 - "API Routes & Auth Pages"
Cohesion: 0.16
Nodes (17): GET(), GET(), Gate(), generateMetadata(), LoginPage(), Gate(), generateMetadata(), SetupPage() (+9 more)

### Community 18 - "Beszel Integration"
Cohesion: 0.17
Nodes (18): Integration, authenticate(), BeszelSystem, beszelSystems(), num(), RawInfo, testBeszel(), tokens (+10 more)

### Community 19 - "WAF & Locale Proxy"
Cohesion: 0.18
Nodes (17): isLocale(), pickLocale(), ALLOWED_METHODS, banRemaining(), clientIp(), Counter, decode(), POLICIES (+9 more)

### Community 20 - "Network Page UI"
Cohesion: 0.22
Nodes (18): generateMetadata(), Ipam(), IpTable(), NetworkPage(), SubnetDetail(), usage(), ConfirmButton(), Diagnostics() (+10 more)

### Community 21 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, allowImportingTsExtensions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib (+11 more)

### Community 22 - "Inventory Forms & Tables"
Cohesion: 0.15
Nodes (15): SubnetOption, ASSET_KINDS, ASSET_STATUS_META, ASSET_STATUSES, AssetStatus, DISK_TYPE_LABEL, DISK_TYPES, RAM_TYPES (+7 more)

### Community 23 - "CI & Container Release"
Cohesion: 0.15
Nodes (16): Docker image workflow (GHCR multi-arch), build job (native runner per platform), GitHub Container Registry (ghcr.io), merge job (multi-arch manifest), stable branch release trigger, Homelab management app requirements, homelab compose service, pnpm allowBuilds (native builds disabled) (+8 more)

### Community 24 - "Kind Icons & Map Nodes"
Cohesion: 0.15
Nodes (15): ICONS, KindAvatar(), KindIcon(), AssetNode, AssetNodeData, AssetNodeView, ExternalNode, ExternalNodeView (+7 more)

### Community 25 - "IP Grid & Constants"
Cohesion: 0.13
Nodes (15): CELL_STYLE, GridCell, ACTIVE_DEPLOYMENT_STATUSES, DEPLOYMENT_KINDS, FW_PROTOCOL_LABEL, FW_PROTOCOLS, FW_TARGET_LABEL, FW_TARGETS (+7 more)

### Community 26 - "Package Manifest"
Cohesion: 0.12
Nodes (15): name, packageManager, private, version, babel-plugin-react-compiler, react-dom, tailwindcss, @tailwindcss/turbopack (+7 more)

### Community 27 - "Integration Config"
Cohesion: 0.23
Nodes (14): saveIntegrationAction(), testIntegrationAction(), IntegrationType, buildConfig(), createIntegration(), getIntegration(), hostOf(), hydrate() (+6 more)

### Community 28 - "Authentication"
Cohesion: 0.30
Nodes (14): changePasswordAction(), credentials, DUMMY_HASH, lockedMessage(), loginAction(), safeNext(), setupAction(), createSession() (+6 more)

### Community 29 - "Homelab Map Editing"
Cohesion: 0.25
Nodes (13): createLinkAction(), deleteLinkAction(), resetPositionsAction(), savePositionsAction(), autoLayout(), Flow(), LINK_KINDS, LinkKind (+5 more)

### Community 30 - "HTTP Client & Maintenant"
Cohesion: 0.18
Nodes (13): HttpOptions, insecureAgent, parseHeader(), secureAgent, arr(), get(), MaintenantCertificate, MaintenantContainer (+5 more)

### Community 31 - "Asset Detail Page"
Cohesion: 0.29
Nodes (13): AssetDetail(), AssetPage(), generateMetadata(), Spec(), StatusDot(), AssetCards(), AssetTable(), resourceSummary() (+5 more)

### Community 32 - "Tasks Kanban"
Cohesion: 0.26
Nodes (12): Board(), generateMetadata(), TasksPage(), TaskBoard(), Priority, hydrate(), listTasks(), openTasks() (+4 more)

### Community 33 - "Root Layout & PWA"
Cohesion: 0.21
Nodes (9): geist, generateMetadata(), RootLayout(), viewport, PwaRegister(), I18nProvider(), LocaleContext, LOCALES (+1 more)

### Community 34 - "i18n Translation"
Cohesion: 0.23
Nodes (9): en, cache, DICTS, fill(), Params, Pattern, patternCache, patterns() (+1 more)

### Community 35 - "Inventory Actions"
Cohesion: 0.23
Nodes (11): deleteAssetAction(), duplicateAssetAction(), setAssetStatusAction(), AssetError, columns(), deleteAsset(), duplicateAsset(), setAssetStatus() (+3 more)

### Community 36 - "Firewall Rules"
Cohesion: 0.21
Nodes (10): FwProtocol, FwTarget, createRule(), listRules(), moveRule(), defaultFirewallPolicy(), getSetting(), NetAsset (+2 more)

### Community 37 - "SSH Key Management"
Cohesion: 0.35
Nodes (10): deleteSshKeyAction(), saveSshKeyAction(), deleteSshKey(), fingerprint(), generateSshKey(), getSshKey(), importSshKey(), save() (+2 more)

### Community 38 - "Runtime Dependencies"
Cohesion: 0.18
Nodes (11): dependencies, geist, lucide-react, next, react, react-dom, server-only, ssh2 (+3 more)

### Community 39 - "Dev Dependencies"
Cohesion: 0.18
Nodes (11): devDependencies, babel-plugin-react-compiler, eslint, eslint-config-next, tailwindcss, @tailwindcss/turbopack, @types/node, @types/react (+3 more)

### Community 40 - "README Feature Modules"
Cohesion: 0.20
Nodes (11): Beszel integration, Dashboard module, Deployments module, Inventory module, Network (IPAM) module, Maintenant integration, Interactive map (React Flow topology), Monitoring (availability probes, incidents) (+3 more)

### Community 41 - "Task Actions"
Cohesion: 0.25
Nodes (8): clearDoneTasksAction(), deleteTaskAction(), moveTaskAction(), Parsed, clearDoneTasks(), deleteTask(), moveTask(), FormState

### Community 42 - "VPN Tunnels"
Cohesion: 0.33
Nodes (8): VpnType, createTunnel(), getTunnel(), hydrate(), listTunnels(), Row, updateTunnel(), values()

### Community 43 - "npm Scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, start, test

### Community 44 - "ESLint Config"
Cohesion: 0.50
Nodes (3): eslintConfig, eslint, eslint-config-next

### Community 45 - "Security Headers & CSP"
Cohesion: 0.50
Nodes (3): CSP, nextConfig, SECURITY_HEADERS

### Community 47 - "Security Hardening Docs"
Cohesion: 0.67
Nodes (3): robots.txt (disallow all), Brute-force protection (lockouts, IP bans), WAF (src/lib/security.ts via src/proxy.ts)

## Knowledge Gaps
- **194 isolated node(s):** `eslintConfig`, `CSP`, `SECURITY_HEADERS`, `nextConfig`, `name` (+189 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 218 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `next` connect `List Pages` to `UI Kit & Auth Forms`, `Uptime Probes & Monitors`, `App Shell & Layout`, `Deployment Detail UI`, `Map & Edit Forms`, `App Shortcuts & Icons`, `Deployments Data & Actions`, `CRUD Server Actions`, `Storage, Backup & Uploads`, `Dashboard Widgets`, `Proxmox Multi-node Actions`, `Monitoring & App Pages`, `API Routes & Auth Pages`, `WAF & Locale Proxy`, `Network Page UI`, `Inventory Forms & Tables`, `Kind Icons & Map Nodes`, `Package Manifest`, `Integration Config`, `Authentication`, `Homelab Map Editing`, `Asset Detail Page`, `Tasks Kanban`, `Root Layout & PWA`, `Inventory Actions`, `SSH Key Management`, `Task Actions`, `Security Headers & CSP`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **What connects `eslintConfig`, `CSP`, `SECURITY_HEADERS` to the rest of the system?**
  _194 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Kit & Auth Forms` be split into smaller, more focused modules?**
  _Cohesion score 0.06910039113428944 - nodes in this community are weakly interconnected._
- **Why does `requireUser()` connect `CRUD Server Actions` to `Uptime Probes & Monitors`, `App Shell & Layout`, `Deployment Detail UI`, `Map & Edit Forms`, `App Shortcuts & Icons`, `List Pages`, `Deployments Data & Actions`, `Storage, Backup & Uploads`, `Dashboard Widgets`, `Proxmox Multi-node Actions`, `Monitoring & App Pages`, `API Routes & Auth Pages`, `Network Page UI`, `Integration Config`, `Authentication`, `Homelab Map Editing`, `Asset Detail Page`, `Tasks Kanban`, `Inventory Actions`, `SSH Key Management`, `Task Actions`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `Uptime Probes & Monitors` be split into smaller, more focused modules?**
  _Cohesion score 0.0616729088639201 - nodes in this community are weakly interconnected._
- **Why does `server-only` connect `Uptime Probes & Monitors` to `Map & Edit Forms`, `App Shortcuts & Icons`, `List Pages`, `Deployments Data & Actions`, `Storage, Backup & Uploads`, `IPAM Subnets & IPs`, `Proxmox Multi-node Actions`, `SSH & Integration Secrets`, `API Routes & Auth Pages`, `Beszel Integration`, `Inventory Forms & Tables`, `Package Manifest`, `Integration Config`, `Homelab Map Editing`, `HTTP Client & Maintenant`, `Tasks Kanban`, `Firewall Rules`, `SSH Key Management`, `Task Actions`, `VPN Tunnels`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **Should `App Shell & Layout` be split into smaller, more focused modules?**
  _Cohesion score 0.07243195785776997 - nodes in this community are weakly interconnected._