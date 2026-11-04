# Homelab Tools: notes for coding agents

Fusion of homelab-management and homelab-monitoring (see README.md). The interface and all user-facing text are in French.

## Layout and rules

- **server/** is one Go `package main` with two roles chosen by `HLT_ROLE`:
  - the monitoring files keep their original names (hosts.go, monitors.go…);
  - the management port lives in `mg_*.go`;
  - code shared by both roles: `journal.go`, `dbadmin.go`, `selfupdate.go`, `passkeys.go`, `auth.go`, `http.go`.
- **Databases.** Monitoring uses `hlm.db` with `migrations` (db.go). Management uses `homelab.db` with `mgMigrations`: the first nine entries are homelab-management's, copied verbatim. Never edit a released migration; append a new one.
- **One SQLite connection** (`MaxOpenConns(1)`). Inside a transaction, query through the `*sql.Tx` only; a call on `s.db` would wait forever.
- **Settings** are read from memory (`getSetting`). Any write to the `settings` table outside `setSetting` must call `forgetSettings()` after its commit.
- **Read cache.** `cacheJSON` keeps routes polled by every open page for a few seconds. `publish` and any `/api/` write drop it (`cacheGen`). List routes go through `listView`: full data (Node.js history, SSH keys, packages) stays on the routes of one host.
- **Journal.** Monitoring writes are logged by the `journal` middleware, from `journalLabels` keyed by route pattern; handlers only add a name with `logName`. Management handlers call `s.mgLog` with homelab-management's wording. Every new write route must end up in the journal.
- **Management API.** Forms are POSTed as FormData and answer a `formState` (`ok`, `message`, `errors`, `nonce`, `redirect`), like the old Next.js server actions. Validation lives in Go (`mg_form.go`); the browser is not trusted.
- **web/** is React + Vite + Tailwind 4:
  - monitoring UI: `src/pages`, `src/ui.tsx`, `src/layout.tsx`;
  - management UI: `src/mg`, homelab-management's components unchanged as far as possible. `@/` aliases `src/mg`; `next/link` and `next/navigation` are small shims; `src/mg/app` holds the former Next.js pages;
  - counted labels are written `3 hôte(s)` and go through `plural()` (`src/shared/plural.ts`; `tr()` already applies it, Go has the same helper in `http.go`);
  - pages read data with `use(fetcher())`. Fetchers come from `src/mg/lib/data/*` and are cached by `lib/resource.ts`; writes call `invalidate()`. Never create a new promise during render: wrap it in `resource()`;
  - `src/shared` holds what both UIs show identically (journal, database, updates, passkeys);
  - same design system (Dashboard Of Midnights, `midnights.css`) for both: reuse the existing `mm-*` classes and components, no new visual style;
  - one page budget for both: a title and one sentence, 4 `Stat` at most, 2 charts, one table of 6 columns at most, one primary button. What does not fit goes behind tabs (`PageTabs`, `Segmented`), not on the page.
- **agent/** is the Rust agent:
  - the wire format is shared with `server/hosts.go` (`agentInfo`, `agentMetrics`);
  - the files in `deploy/ansible/roles/hlm_agent/files` must stay identical to those in `agent/` (CI checks it).
- **Proxmox integrations** stay independent from the inventory and the monitoring: no automatic link.
- **Security.** Secrets are encrypted (AES-256-GCM, format `v1.` compatible with homelab-management). Root work is only done by fixed scripts started by systemd path units (`apt-action.sh`, `update.sh`), never by the server or the agent.

## Checks before finishing

```sh
cd web && npm run build && npm test
cd server && go vet ./... && go test ./...
cd agent && cargo test
```
