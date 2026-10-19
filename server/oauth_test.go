package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestOAuthClaudeFlow(t *testing.T) {
	s, plain := newTestServer(t)
	cookie := setupAdmin(t, s, plain)
	tlsTS := httptestTLS(t, s)
	s.setSetting("mcp_enabled", "true")
	cl := tlsTS.Client()
	cl.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }

	send := func(method, path, ctype, body string, hdr map[string]string) (int, map[string]any, http.Header) {
		req, _ := http.NewRequest(method, tlsTS.URL+path, strings.NewReader(body))
		if ctype != "" {
			req.Header.Set("Content-Type", ctype)
		}
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		resp, err := cl.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		var out map[string]any
		json.Unmarshal(b, &out)
		return resp.StatusCode, out, resp.Header
	}
	session := map[string]string{"Cookie": sessionCookie + "=" + cookie, "Origin": tlsTS.URL}
	mcpInit := `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}`

	// 1. Unauthenticated call points to the discovery document, which leads to the authorization server.
	code, _, h := send("POST", "/api/mcp", "application/json", mcpInit, nil)
	if code != 401 || !strings.Contains(h.Get("WWW-Authenticate"), `resource_metadata="`+tlsTS.URL+`/.well-known/oauth-protected-resource"`) {
		t.Fatalf("401 challenge: %d %q", code, h.Get("WWW-Authenticate"))
	}
	_, prm, _ := send("GET", "/.well-known/oauth-protected-resource", "", "", nil)
	_, asm, _ := send("GET", "/.well-known/oauth-authorization-server", "", "", nil)
	if prm["resource"] != tlsTS.URL+"/api/mcp" || asm["registration_endpoint"] != tlsTS.URL+"/oauth/register" {
		t.Fatalf("metadata: %v %v", prm, asm)
	}

	// 2. Dynamic registration: Claude's callback is accepted, an unknown site is not.
	if code, _, _ := send("POST", "/oauth/register", "application/json", `{"client_name":"Evil","redirect_uris":["https://evil.example/cb"]}`, nil); code != 400 {
		t.Fatalf("foreign redirect must be refused, got %d", code)
	}
	code, reg, _ := send("POST", "/oauth/register", "application/json",
		`{"client_name":"Claude","redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"token_endpoint_auth_method":"none"}`, nil)
	clientID, _ := reg["client_id"].(string)
	if code != 201 || clientID == "" || reg["client_secret"] != nil {
		t.Fatalf("register: %d %v", code, reg)
	}

	// 3. The signed-in user approves; PKCE S256.
	verifier := "a-long-random-verifier-0123456789-abcdefghijklmnop"
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {"https://claude.ai/api/mcp/auth_callback"},
		"code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "code_challenge_method": {"S256"}, "state": {"xyz"}}
	if code, info, _ := send("GET", "/api/oauth/authorize?"+q.Encode(), "", "", session); code != 200 || info["redirect_host"] != "claude.ai" {
		t.Fatalf("authorize info: %d %v", code, info)
	}
	if code, _, _ := send("POST", "/api/oauth/authorize", "application/json", `{"query":"`+q.Encode()+`","approve":true}`, nil); code != 401 {
		t.Fatalf("approval needs a session, got %d", code)
	}
	_, ap, _ := send("POST", "/api/oauth/authorize", "application/json", `{"query":"`+q.Encode()+`","approve":true}`, session)
	back, _ := url.Parse(ap["redirect"].(string))
	if back.Host != "claude.ai" || back.Query().Get("state") != "xyz" || back.Query().Get("code") == "" {
		t.Fatalf("redirect: %v", ap)
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {back.Query().Get("code")}, "client_id": {clientID},
		"redirect_uri": {"https://claude.ai/api/mcp/auth_callback"}, "code_verifier": {"wrong-verifier-0123456789-0123456789-abcdefgh"}}
	if code, _, _ := send("POST", "/oauth/token", "application/x-www-form-urlencoded", form.Encode(), nil); code != 400 {
		t.Fatalf("bad verifier must fail, got %d", code)
	}
	// The code was burnt by the failed attempt: approve again.
	_, ap, _ = send("POST", "/api/oauth/authorize", "application/json", `{"query":"`+q.Encode()+`","approve":true}`, session)
	back, _ = url.Parse(ap["redirect"].(string))
	form.Set("code", back.Query().Get("code"))
	form.Set("code_verifier", verifier)
	code, tok, _ := send("POST", "/oauth/token", "application/x-www-form-urlencoded", form.Encode(), nil)
	access, _ := tok["access_token"].(string)
	refresh, _ := tok["refresh_token"].(string)
	if code != 200 || access == "" || refresh == "" {
		t.Fatalf("token: %d %v", code, tok)
	}

	// 4. The access token opens /api/mcp; refresh tokens rotate.
	if code, _, _ := send("POST", "/api/mcp", "application/json", mcpInit, map[string]string{"Authorization": "Bearer " + access}); code != 200 {
		t.Fatalf("mcp with OAuth token: %d", code)
	}
	rf := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {clientID}}
	if code, _, _ := send("POST", "/oauth/token", "application/x-www-form-urlencoded", rf.Encode(), nil); code != 200 {
		t.Fatalf("refresh: %d", code)
	}
	if code, _, _ := send("POST", "/oauth/token", "application/x-www-form-urlencoded", rf.Encode(), nil); code != 400 {
		t.Fatalf("a used refresh token must be refused, got %d", code)
	}

	// 5. A client made by hand has a secret (client_secret_basic); revoking it kills its tokens.
	code, made, _ := send("POST", "/api/mcp/clients", "application/json", `{"name":"Mon Claude"}`, session)
	id, secret := made["client_id"].(string), made["client_secret"].(string)
	if code != 201 || !strings.HasPrefix(secret, "mcpcs_") {
		t.Fatalf("create client: %d %v", code, made)
	}
	q.Set("client_id", id)
	_, ap, _ = send("POST", "/api/oauth/authorize", "application/json", `{"query":"`+q.Encode()+`","approve":true}`, session)
	back, _ = url.Parse(ap["redirect"].(string))
	form = url.Values{"grant_type": {"authorization_code"}, "code": {back.Query().Get("code")}, "redirect_uri": {"https://claude.ai/api/mcp/auth_callback"}, "code_verifier": {verifier}}
	basic := map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte(id+":wrong"))}
	if code, _, _ := send("POST", "/oauth/token", "application/x-www-form-urlencoded", form.Encode(), basic); code != 401 {
		t.Fatalf("wrong secret must be refused, got %d", code)
	}
	basic["Authorization"] = "Basic " + base64.StdEncoding.EncodeToString([]byte(id+":"+secret))
	_, tok, _ = send("POST", "/oauth/token", "application/x-www-form-urlencoded", form.Encode(), basic)
	access2, _ := tok["access_token"].(string)
	if code, _, _ := send("DELETE", "/api/mcp/clients/"+id, "", "", session); code != 204 {
		t.Fatalf("revoke: %d", code)
	}
	if code, _, _ := send("POST", "/api/mcp", "application/json", mcpInit, map[string]string{"Authorization": "Bearer " + access2}); code != 401 {
		t.Fatalf("revoked client's token must be refused, got %d", code)
	}

	// 6. Registration can be turned off.
	s.setSetting("mcp_dcr", "false")
	if code, _, _ := send("POST", "/oauth/register", "application/json", `{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}`, nil); code != 403 {
		t.Fatalf("disabled registration: %d", code)
	}
}

func httptestTLS(t *testing.T, s *Server) *httptest.Server {
	ts := httptest.NewTLSServer(s.routes())
	t.Cleanup(ts.Close)
	return ts
}

func TestOAuthTablesOnManagement(t *testing.T) {
	s, _, _ := newMgTestServer(t)
	if _, _, err := s.insertClient("Claude", claudeRedirects, true, false); err != nil {
		t.Fatal(err)
	}
	if list, err := s.loadClients(""); err != nil || len(list) != 1 {
		t.Fatalf("%v %v", list, err)
	}
}
