package main

// TrueNAS probes: pool health, pool usage and active alerts, read with an API key over the
// JSON-RPC 2.0 WebSocket API (TrueNAS 25.04 and later, wss://<host>/api/current). Nothing is
// installed on the NAS, whose system is read-only.

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type truenasPool struct {
	Name      string  `json:"name"`
	Status    string  `json:"status"` // ONLINE, DEGRADED, FAULTED, OFFLINE, UNAVAIL, REMOVED
	Healthy   bool    `json:"healthy"`
	Size      float64 `json:"size"`
	Allocated float64 `json:"allocated"`
}

type truenasAlert struct {
	Level     string `json:"level"` // INFO … WARNING, ERROR, CRITICAL, ALERT, EMERGENCY
	Formatted string `json:"formatted"`
	Dismissed bool   `json:"dismissed"`
}

func checkTrueNAS(ctx context.Context, m *Monitor) checkResult {
	if m.Config.APIKey == "" {
		return checkResult{StatusUnknown, nil, "Clé d'API TrueNAS manquante", nil, nil, 0}
	}
	wsURL := "ws" + strings.TrimPrefix(strings.TrimRight(m.Target, "/"), "http") + "/api/current"
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: m.Config.IgnoreTLS}
	defer tr.CloseIdleConnections()
	c, _, err := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPClient: &http.Client{Transport: tr}})
	if err != nil {
		return checkResult{StatusMajor, nil, "Connexion impossible : " + err.Error(), nil, nil, 0}
	}
	defer c.CloseNow()
	c.SetReadLimit(8 << 20)

	id := 0
	call := func(method string, params []any, out any) error {
		id++
		if err := wsjson.Write(ctx, c, map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
			return err
		}
		for { // skip notifications (no id) until our answer
			var resp struct {
				ID     *int `json:"id"`
				Result any  `json:"result"`
				Error  *struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			resp.Result = out
			if err := wsjson.Read(ctx, c, &resp); err != nil {
				return err
			}
			if resp.ID == nil || *resp.ID != id {
				continue
			}
			if resp.Error != nil {
				return fmt.Errorf("%s : %s", method, resp.Error.Message)
			}
			return nil
		}
	}
	var ok bool
	if err := call("auth.login_with_api_key", []any{m.Config.APIKey}, &ok); err != nil || !ok {
		return checkResult{StatusMajor, nil, "Clé d'API refusée par TrueNAS", nil, nil, 0}
	}
	var pools []truenasPool
	if err := call("pool.query", []any{}, &pools); err != nil {
		return checkResult{StatusMajor, nil, err.Error(), nil, nil, 0}
	}
	var alerts []truenasAlert
	if err := call("alert.list", []any{}, &alerts); err != nil {
		return checkResult{StatusMajor, nil, err.Error(), nil, nil, 0}
	}
	c.Close(websocket.StatusNormalClosure, "")
	limit := 90.0
	if m.Config.MaxValue != nil {
		limit = *m.Config.MaxValue
	}
	return truenasVerdict(pools, alerts, limit)
}

// truenasVerdict: a faulted pool is a major outage, a degraded one a partial outage; a pool
// fuller than limit % or an active critical alert makes the probe degraded. The value is the
// usage of the fullest pool.
func truenasVerdict(pools []truenasPool, alerts []truenasAlert, limit float64) checkResult {
	status := StatusOperational
	worse := func(s string) {
		if statusRank(s) > statusRank(status) {
			status = s
		}
	}
	var problems, usage []string
	var fullest *float64
	for _, p := range pools {
		switch {
		case p.Status == "FAULTED" || p.Status == "UNAVAIL" || p.Status == "OFFLINE" || p.Status == "REMOVED":
			worse(StatusMajor)
			problems = append(problems, fmt.Sprintf("pool %s %s", p.Name, p.Status))
		case p.Status != "ONLINE" || !p.Healthy:
			worse(StatusMinor)
			problems = append(problems, fmt.Sprintf("pool %s %s", p.Name, p.Status))
		}
		if p.Size > 0 {
			pct := p.Allocated * 100 / p.Size
			if fullest == nil || pct > *fullest {
				fullest = &pct
			}
			usage = append(usage, fmt.Sprintf("%s %.0f %%", p.Name, pct))
			if pct >= limit {
				worse(StatusDegraded)
				problems = append(problems, fmt.Sprintf("pool %s plein à %.0f %%", p.Name, pct))
			}
		}
	}
	for _, a := range alerts {
		if !a.Dismissed && slices.Contains([]string{"CRITICAL", "ALERT", "EMERGENCY"}, a.Level) {
			worse(StatusDegraded)
			problems = append(problems, strings.TrimSpace(a.Formatted))
		}
	}
	msg := fmt.Sprintf("%d pool(s) sain(s)", len(pools))
	if len(usage) > 0 {
		msg += " · " + strings.Join(usage, ", ")
	}
	if len(problems) > 0 {
		msg = strings.Join(problems, " ; ")
	}
	return checkResult{status, nil, msg, nil, fullest, 0}
}
