package main

// MCP server (Model Context Protocol, Streamable HTTP transport with JSON answers) so an
// assistant such as Claude can ask "do I have a service down?". Read-only tools only.
// It is off by default, answers only over HTTPS (behind a reverse proxy) and requires a
// bearer token generated in the settings, stored hashed. Both roles have it, each with
// its own tools.

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

const mcpProtocol = "2025-06-18"

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
	run         func(ctx context.Context, args map[string]any) (any, error)
}

func noArgs() map[string]any { return map[string]any{"type": "object", "properties": map[string]any{}} }

func oneArg(name, desc string, required bool) map[string]any {
	s := map[string]any{"type": "object", "properties": map[string]any{name: map[string]any{"type": "string", "description": desc}}}
	if required {
		s["required"] = []string{name}
	}
	return s
}

func argString(args map[string]any, k string) string {
	switch v := args[k].(type) {
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

/* ---------------------------------------------------------------- tools */

func pctOf(used, total float64) any {
	if total <= 0 {
		return nil
	}
	return math.Round(used/total*1000) / 10
}

func (s *Server) mcpTools() []mcpTool {
	if s.cfg.Role == RoleManagement {
		return s.mgMCPTools()
	}
	hostSummary := func(h Host) map[string]any {
		var l struct{ CPU, MemUsed, MemTotal, DiskUsed, DiskTotal float64 }
		var raw map[string]float64
		json.Unmarshal(h.Latest, &raw)
		l.CPU, l.MemUsed, l.MemTotal, l.DiskUsed, l.DiskTotal = raw["cpu"], raw["mem_used"], raw["mem_total"], raw["disk_used"], raw["disk_total"]
		out := map[string]any{"id": h.ID, "nom": h.Name, "etat": statusLabels[h.Status], "connecte": h.Connected, "maintenance": h.Maintenance,
			"cpu_pct": math.Round(l.CPU*10) / 10, "memoire_pct": pctOf(l.MemUsed, l.MemTotal), "disque_pct": pctOf(l.DiskUsed, l.DiskTotal),
			"dernier_contact": time.Unix(h.LastSeen, 0).In(localTZ()).Format(time.DateTime)}
		if h.Updates != nil {
			out["mises_a_jour"] = map[string]any{"en_attente": h.Updates.Pending, "securite": h.Updates.Security, "redemarrage_requis": h.Updates.RebootRequired}
		}
		return out
	}
	monitorSummary := func(m Monitor) map[string]any {
		out := map[string]any{"id": m.ID, "nom": m.Name, "type": m.Type, "cible": m.Target, "etat": statusLabels[m.Status], "message": m.Message,
			"active": m.Enabled, "maintenance": m.Maintenance}
		if m.LatencyMs != nil {
			out["latence_ms"] = math.Round(*m.LatencyMs)
		}
		if m.CertExpires != nil {
			out["certificat_expire_dans_jours"] = int(time.Until(time.Unix(*m.CertExpires, 0)).Hours() / 24)
		}
		return out
	}
	return []mcpTool{
		{Name: "etat_global", Description: "État global du homelab : statut général, nombre d'hôtes et de sondes, et liste de tout ce qui n'est pas opérationnel.",
			InputSchema: noArgs(), run: func(context.Context, map[string]any) (any, error) {
				hosts, err := s.loadHosts("")
				if err != nil {
					return nil, err
				}
				mons, err := s.loadMonitors("WHERE enabled=1")
				if err != nil {
					return nil, err
				}
				var statuses []string
				problems := []map[string]any{}
				for _, h := range hosts {
					statuses = append(statuses, h.Status)
					if h.Status != StatusOperational {
						problems = append(problems, map[string]any{"type": "hôte", "nom": h.Name, "etat": statusLabels[h.Status]})
					}
				}
				for _, m := range mons {
					statuses = append(statuses, m.Status)
					if m.Status != StatusOperational {
						problems = append(problems, map[string]any{"type": "sonde", "nom": m.Name, "etat": statusLabels[m.Status], "message": m.Message})
					}
				}
				return map[string]any{"statut": statusLabels[overallStatus(statuses)], "hotes": len(hosts), "sondes_actives": len(mons), "problemes": problems}, nil
			}},
		{Name: "lister_hotes", Description: "Hôtes équipés de l'agent avec état, CPU, mémoire, disque et mises à jour en attente.",
			InputSchema: noArgs(), run: func(context.Context, map[string]any) (any, error) {
				hosts, err := s.loadHosts("")
				if err != nil {
					return nil, err
				}
				out := []map[string]any{}
				for _, h := range hosts {
					out = append(out, hostSummary(h))
				}
				return out, nil
			}},
		{Name: "details_hote", Description: "Détails d'un hôte (système, matériel, dernières mesures, mises à jour), par nom ou identifiant.",
			InputSchema: oneArg("hote", "Nom ou identifiant de l'hôte", true), run: func(_ context.Context, args map[string]any) (any, error) {
				q := argString(args, "hote")
				hosts, err := s.loadHosts("")
				if err != nil {
					return nil, err
				}
				for _, h := range hosts {
					if strconv.FormatInt(h.ID, 10) == q || strings.EqualFold(h.Name, q) {
						out := hostSummary(h)
						out["systeme"], out["mesures"] = h.Info, h.Latest
						if h.Updates != nil {
							out["paquets"] = h.Updates.Packages
						}
						return out, nil
					}
				}
				return nil, fmt.Errorf("aucun hôte « %s »", q)
			}},
		{Name: "lister_sondes", Description: "Sondes (HTTP, TCP, DNS, SSL, SNMP…) avec état, dernier message, latence et expiration des certificats.",
			InputSchema: noArgs(), run: func(context.Context, map[string]any) (any, error) {
				mons, err := s.loadMonitors("")
				if err != nil {
					return nil, err
				}
				out := []map[string]any{}
				for _, m := range mons {
					out = append(out, monitorSummary(m))
				}
				return out, nil
			}},
		{Name: "mises_a_jour", Description: "Hôtes avec des mises à jour système en attente, de sécurité ou un redémarrage requis.",
			InputSchema: noArgs(), run: func(context.Context, map[string]any) (any, error) {
				hosts, err := s.loadHosts("")
				if err != nil {
					return nil, err
				}
				out := []map[string]any{}
				for _, h := range hosts {
					if u := h.Updates; u != nil && (u.Pending > 0 || u.RebootRequired) {
						out = append(out, map[string]any{"hote": h.Name, "en_attente": u.Pending, "securite": u.Security, "redemarrage_requis": u.RebootRequired})
					}
				}
				return out, nil
			}},
	}
}

func (s *Server) mgMCPTools() []mcpTool {
	compact := func(rows []map[string]any, keys ...string) []map[string]any {
		out := []map[string]any{}
		for _, r := range rows {
			m := map[string]any{}
			for _, k := range keys {
				if v := r[k]; v != nil && v != "" {
					m[k] = v
				}
			}
			out = append(out, m)
		}
		return out
	}
	assetKeys := []string{"id", "display_name", "hostname", "kind", "status", "role", "primary_ip", "parent_name", "os", "os_version", "cpu_cores", "ram_gb", "tags"}
	return []mcpTool{
		{Name: "rechercher_inventaire", Description: "Recherche dans l'inventaire (nom, nom d'hôte, IP, MAC, rôle, tag, n° de série). Sans texte : tout l'inventaire.",
			InputSchema: oneArg("recherche", "Texte recherché", false), run: func(_ context.Context, args map[string]any) (any, error) {
				rows, err := s.listAssets(map[string]string{"q": argString(args, "recherche")})
				return compact(rows, assetKeys...), err
			}},
		{Name: "details_element", Description: "Fiche complète d'un élément de l'inventaire (matériel, adresses, hébergés), par identifiant.",
			InputSchema: oneArg("id", "Identifiant de l'élément", true), run: func(_ context.Context, args map[string]any) (any, error) {
				id, _ := strconv.ParseInt(argString(args, "id"), 10, 64)
				a, err := s.row(assetSelect+" WHERE a.id = ?", id)
				if err != nil {
					return nil, fmt.Errorf("élément %d introuvable", id)
				}
				ips, _ := s.rows(`SELECT address, mac, status, is_primary FROM ip_addresses WHERE asset_id = ?`, id)
				children, _ := s.rows(`SELECT id, display_name, kind, status FROM assets WHERE parent_id = ?`, id)
				a["adresses"], a["heberges"] = ips, children
				return a, nil
			}},
		{Name: "lister_taches", Description: "Tâches du Kanban qui ne sont pas terminées, avec priorité et échéance.",
			InputSchema: noArgs(), run: func(context.Context, map[string]any) (any, error) {
				rows, err := s.rows(taskSelect + ` WHERE t.status != 'done' ORDER BY COALESCE(t.due_date, '9999'), t.id`)
				return compact(rows, "id", "title", "status", "priority", "due_date", "asset_name", "deployment_title"), err
			}},
		{Name: "lister_deploiements", Description: "Déploiements en cours ou prévus, avec état, priorité, cible et avancement de la checklist.",
			InputSchema: noArgs(), run: func(context.Context, map[string]any) (any, error) {
				c, args := inList("d.status", activeDeployments)
				rows, err := s.rows(deploymentSelect+" WHERE "+c+deploymentOrder, args...)
				return compact(rows, "id", "title", "kind", "status", "priority", "target_host_name", "target_date", "steps_done", "steps_total"), err
			}},
		{Name: "reseau", Description: "Plan d'adressage : VLAN et sous-réseaux avec passerelle, plage DHCP et occupation.",
			InputSchema: noArgs(), run: func(context.Context, map[string]any) (any, error) {
				subnets, err := s.listSubnets()
				if err != nil {
					return nil, err
				}
				vlans, err := s.rows(vlanSelect)
				return map[string]any{"vlans": compact(vlans, "vlan_id", "name", "subnet_count", "asset_count"),
					"sous_reseaux": compact(subnets, "name", "cidr", "vlan_number", "gateway", "dhcp_start", "dhcp_end", "used", "reserved", "capacity")}, err
			}},
		{Name: "etat_monitoring", Description: "Hôtes et sondes du monitoring qui ne sont pas opérationnels, vus depuis la gestion.",
			InputSchema: noArgs(), run: func(ctx context.Context, _ map[string]any) (any, error) {
				list, err := s.loadIntegrations(`WHERE type = 'hlm' AND enabled = 1`)
				if err != nil {
					return nil, err
				}
				problems := []map[string]any{}
				for _, src := range collect(ctx, list, s.hlmData) {
					if !src.OK {
						problems = append(problems, map[string]any{"source": src.Name, "erreur": src.Error})
						continue
					}
					for _, h := range src.Data.Hosts {
						if h["status"] != StatusOperational {
							problems = append(problems, map[string]any{"type": "hôte", "nom": h["name"], "etat": statusLabels[fmtVal(h["status"])]})
						}
					}
					for _, m := range src.Data.Monitors {
						if m["enabled"] == true && m["status"] != StatusOperational {
							problems = append(problems, map[string]any{"type": "sonde", "nom": m["name"], "etat": statusLabels[fmtVal(m["status"])], "message": m["message"]})
						}
					}
				}
				return map[string]any{"sources": len(list), "problemes": problems}, nil
			}},
	}
}

/* ---------------------------------------------------------------- transport */

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

func rpcResult(id json.RawMessage, result any) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "result": result}
}

func rpcError(id json.RawMessage, code int, msg string) map[string]any {
	return map[string]any{"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": msg}}
}

func (s *Server) mcpAuthorized(r *http.Request) bool {
	tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	want := s.getSetting("mcp_token_hash", "")
	return ok && want != "" && subtle.ConstantTimeCompare([]byte(fmt.Sprintf("%x", hashToken(tok))), []byte(want)) == 1
}

func (s *Server) handleMCP(w http.ResponseWriter, r *http.Request) {
	if !s.isHTTPS(r) {
		writeErr(w, 403, "Le serveur MCP n'est disponible qu'en HTTPS (derrière un reverse proxy)")
		return
	}
	if s.getSetting("mcp_enabled", "false") != "true" {
		writeErr(w, 404, "Le serveur MCP est désactivé (Paramètres → Serveur MCP)")
		return
	}
	if !s.mcpAuthorized(r) {
		if !s.limiter.allow("mcp:" + s.clientIP(r)) {
			writeErr(w, 429, "Trop de tentatives")
			return
		}
		w.Header().Set("WWW-Authenticate", `Bearer realm="mcp"`)
		writeErr(w, 401, "Jeton MCP manquant ou invalide")
		return
	}
	if r.Method != http.MethodPost {
		// No server-initiated stream: every answer comes back on the POST.
		w.Header().Set("Allow", "POST")
		writeErr(w, 405, "Utilisez POST")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeErr(w, 413, "Requête trop volumineuse")
		return
	}
	var batch []rpcReq
	single := !strings.HasPrefix(strings.TrimSpace(string(body)), "[")
	if single {
		var one rpcReq
		if json.Unmarshal(body, &one) != nil {
			writeJSON(w, 400, rpcError(nil, -32700, "JSON invalide"))
			return
		}
		batch = []rpcReq{one}
	} else if json.Unmarshal(body, &batch) != nil {
		writeJSON(w, 400, rpcError(nil, -32700, "JSON invalide"))
		return
	}
	var out []map[string]any
	for _, req := range batch {
		if resp := s.mcpDispatch(r.Context(), req); resp != nil && len(req.ID) > 0 {
			out = append(out, resp)
		}
	}
	switch {
	case len(out) == 0:
		w.WriteHeader(http.StatusAccepted) // notifications only
	case single:
		writeJSON(w, 200, out[0])
	default:
		writeJSON(w, 200, out)
	}
}

func (s *Server) mcpDispatch(ctx context.Context, req rpcReq) map[string]any {
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		json.Unmarshal(req.Params, &p)
		version := mcpProtocol
		if p.ProtocolVersion != "" && p.ProtocolVersion <= mcpProtocol {
			version = p.ProtocolVersion
		}
		name := "homelab-monitoring"
		if s.cfg.Role == RoleManagement {
			name = "homelab-management"
		}
		return rpcResult(req.ID, map[string]any{
			"protocolVersion": version,
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": name, "version": version},
			"instructions":    "Outils en lecture seule sur le homelab. Les réponses sont en français.",
		})
	case "ping":
		return rpcResult(req.ID, map[string]any{})
	case "tools/list":
		return rpcResult(req.ID, map[string]any{"tools": s.mcpTools()})
	case "tools/call":
		var p struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if json.Unmarshal(req.Params, &p) != nil {
			return rpcError(req.ID, -32602, "Paramètres invalides")
		}
		for _, t := range s.mcpTools() {
			if t.Name != p.Name {
				continue
			}
			ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			res, err := t.run(ctx, p.Arguments)
			if err != nil {
				return rpcResult(req.ID, map[string]any{"isError": true, "content": []map[string]any{{"type": "text", "text": err.Error()}}})
			}
			b, _ := json.MarshalIndent(res, "", " ")
			return rpcResult(req.ID, map[string]any{"content": []map[string]any{{"type": "text", "text": string(b)}}})
		}
		return rpcError(req.ID, -32602, "Outil inconnu : "+p.Name)
	}
	if strings.HasPrefix(req.Method, "notifications/") {
		return nil
	}
	return rpcError(req.ID, -32601, "Méthode inconnue : "+req.Method)
}

/* ---------------------------------------------------------------- settings */

func (s *Server) handleMCPState(w http.ResponseWriter, r *http.Request) {
	names := []string{}
	tools := s.mcpTools()
	sort.Slice(tools, func(i, j int) bool { return tools[i].Name < tools[j].Name })
	for _, t := range tools {
		names = append(names, t.Name)
	}
	writeJSON(w, 200, map[string]any{
		"enabled": s.getSetting("mcp_enabled", "false") == "true", "token_set": s.getSetting("mcp_token_hash", "") != "",
		"https": s.isHTTPS(r), "url": s.baseURL(r) + "/api/mcp", "tools": names,
	})
}

func (s *Server) handleMCPConfig(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled  *bool `json:"enabled"`
		NewToken bool  `json:"new_token"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	out := map[string]any{}
	if in.Enabled != nil {
		if err := s.setSetting("mcp_enabled", strconv.FormatBool(*in.Enabled)); err != nil {
			serverErr(w, err)
			return
		}
		logName(r, map[bool]string{true: "activé", false: "désactivé"}[*in.Enabled])
	}
	if in.NewToken {
		tok := "mcp_" + randomToken(32)
		if err := s.setSetting("mcp_token_hash", fmt.Sprintf("%x", hashToken(tok))); err != nil {
			serverErr(w, err)
			return
		}
		out["token"] = tok // shown once
		logName(r, "nouveau jeton")
		slog.Info("mcp token regenerated")
	}
	writeJSON(w, 200, out)
}
