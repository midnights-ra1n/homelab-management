package main

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// Components go into machines only, become in use there and return to the stock with their machine.
func TestHardwareStock(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	ok := func(out string) {
		t.Helper()
		if !strings.Contains(out, `"ok":true`) {
			t.Fatal(out)
		}
	}
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"PVE-01"}, "category": {"server"}, "status": {"in_use"}}))
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"PVE-02"}, "category": {"server"}, "status": {"stock"}}))
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"DDR4 16 Go"}, "category": {"ram"}, "status": {"stock"}, "parent_id": {"1"}, "capacity_gb": {"16"}}))
	var status string
	s.db.QueryRow(`SELECT status FROM hardware_items WHERE id = 3`).Scan(&status)
	if status != "in_use" {
		t.Fatalf("installed component status %q", status)
	}
	if out := postForm(t, ts, tok, "/api/mg/hardware/2", url.Values{"name": {"PVE-02"}, "category": {"server"}, "status": {"stock"}, "parent_id": {"1"}}); !strings.Contains(out, "équipement ne s'installe") {
		t.Fatal("machine in machine accepted:", out)
	}
	if out := postForm(t, ts, tok, "/api/mg/hardware/1", url.Values{"name": {"PVE-01"}, "category": {"ram"}, "status": {"in_use"}}); !strings.Contains(out, "Retire d'abord") {
		t.Fatal("machine with components turned into a component:", out)
	}

	send := func(method, path, body string) int {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", ts.URL)
		req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if c := send("POST", "/api/mg/hardware/3/install", `{"parent_id":3}`); c != 400 {
		t.Fatalf("install into a component: %d", c)
	}
	if c := send("POST", "/api/mg/hardware/3/install", `{"parent_id":2}`); c != 204 {
		t.Fatalf("move to PVE-02: %d", c)
	}
	if c := send("DELETE", "/api/mg/hardware/2", ""); c != 204 {
		t.Fatalf("delete machine: %d", c)
	}
	var parent any
	s.db.QueryRow(`SELECT status, parent_id FROM hardware_items WHERE id = 3`).Scan(&status, &parent)
	if status != "stock" || parent != nil {
		t.Fatalf("component of a deleted machine: %q %v", status, parent)
	}
}

// Installing from a stock lot takes one piece out of it.
func TestHardwareLotSplit(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"PVE-01"}, "category": {"server"}, "status": {"in_use"}})
	if out := postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"DDR4 16 Go"}, "category": {"ram"}, "status": {"stock"}, "quantity": {"4"}}); !strings.Contains(out, `"ok":true`) {
		t.Fatal(out)
	}
	req, _ := http.NewRequest("POST", ts.URL+"/api/mg/hardware/2/install", strings.NewReader(`{"parent_id":1}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", ts.URL)
	req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
	if resp, err := http.DefaultClient.Do(req); err != nil || resp.StatusCode != 204 {
		t.Fatal("install from lot", err)
	}
	var lot, installed int
	var status string
	s.db.QueryRow(`SELECT quantity FROM hardware_items WHERE id = 2 AND parent_id IS NULL`).Scan(&lot)
	s.db.QueryRow(`SELECT quantity, status FROM hardware_items WHERE parent_id = 1`).Scan(&installed, &status)
	if lot != 3 || installed != 1 || status != "in_use" {
		t.Fatalf("lot %d, installed %d %q", lot, installed, status)
	}
}

// Reminders: a one-off one is deleted when done, a repeating one moves to today + its period.
func TestUpdateReminders(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	send := func(method, path, body string) (int, string) {
		req, _ := http.NewRequest(method, ts.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", ts.URL)
		req.AddCookie(&http.Cookie{Name: mgSessionCookie, Value: tok})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if c, _ := send("POST", "/api/reminders", `{"host":"","due_date":"2026-01-01"}`); c != 400 {
		t.Fatalf("empty host: %d", c)
	}
	if c, out := send("POST", "/api/reminders", `{"host":"nas","due_date":"2020-01-01","repeat_days":30,"note":"noyau"}`); c != 201 {
		t.Fatal(c, out)
	}
	if c, _ := send("POST", "/api/reminders", `{"host":"pve","due_date":"2999-01-01"}`); c != 201 {
		t.Fatal(c)
	}
	_, out := send("GET", "/api/reminders", "")
	if !strings.Contains(out, `"host":"nas","host_ref":"","due_date":"2020-01-01","repeat_days":30,"note":"noyau","due":true`) || !strings.Contains(out, `"due":false`) {
		t.Fatal(out)
	}
	if c, out := send("POST", "/api/reminders/1/done", ""); c != 200 || !strings.Contains(out, today()[:4]) {
		t.Fatal("done repeating:", c, out)
	}
	if c, _ := send("POST", "/api/reminders/2/done", ""); c != 200 {
		t.Fatal(c)
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM update_reminders`).Scan(&n)
	if n != 1 {
		t.Fatalf("%d reminders left", n)
	}
	var label string
	s.db.QueryRow(`SELECT summary FROM activity WHERE entity_type = 'reminder' ORDER BY id LIMIT 1`).Scan(&label)
	if label != "Rappel de mise à jour ajouté : « nas »" {
		t.Fatalf("journal %q", label)
	}
}

// Monitoring: reminders through a v1 token, sent once when due under the host's current name.
func TestRemindersAPIAndNotify(t *testing.T) {
	s, ts := newTestServer(t)
	cookie := setupAdmin(t, s, ts)
	s.setSetting("api_enabled", "true")
	res, _ := s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at) VALUES('nas',x'09',0)`)
	id, _ := res.LastInsertId()
	ro := createToken(t, ts, cookie, []string{"reminders:read"}, nil)
	rw := createToken(t, ts, cookie, []string{"reminders:read", "reminders:write"}, nil)
	body := `{"host":"nas","host_ref":"h` + jsonNum(id) + `","due_date":"2020-01-01","note":"noyau"}`
	if code, _ := apiReq(t, ts, "POST", "/api/v1/reminders", ro, body); code != 403 {
		t.Fatalf("write with read scope: %d", code)
	}
	if code, out := apiReq(t, ts, "POST", "/api/v1/reminders", rw, body); code != 201 {
		t.Fatal(code, out)
	}
	if code, out := apiReq(t, ts, "GET", "/api/v1/reminders", ro, ""); code != 200 || len(out["reminders"].([]any)) != 1 {
		t.Fatal(code, out)
	}
	s.db.Exec(`UPDATE hosts SET name='nas-01' WHERE id=?`, id)
	s.notifyReminders()
	s.notifyReminders() // already sent for this due date
	if len(s.notifier.pending) != 1 || s.notifier.pending[0].Kind != KindReminder || s.notifier.pending[0].Name != "nas-01" {
		t.Fatalf("notifications %+v", s.notifier.pending)
	}
}

// Every item gets the next homelab ID unless one is typed; a machine linked to the inventory can
// take its components from it.
func TestHardwareHomelabIDAndImport(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	s.db.Exec(`INSERT INTO assets (kind, display_name, cpu_model, cpu_cores, ram_gb, ram_type, disks, nics)
	  VALUES ('physical', 'pve-01', 'Xeon E5-2680 v4', 14, 64, 'DDR4', '[{"name":"sda","type":"ssd","capacity_gb":960,"usage":""}]', '[{"name":"eno1","mac":"aa:bb","speed":"1G"}]')`)
	ok := func(out string) {
		t.Helper()
		if !strings.Contains(out, `"ok":true`) {
			t.Fatal(out)
		}
	}
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"PVE-01"}, "category": {"server"}, "status": {"in_use"}, "asset_id": {"1"}, "import_components": {"on"}}))
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"Clé USB"}, "category": {"other"}, "status": {"stock"}, "hl_id": {"HL-0100"}}))
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"Câble"}, "category": {"other"}, "status": {"stock"}}))
	if out := postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"Autre"}, "category": {"other"}, "status": {"stock"}, "hl_id": {"hl-0100"}}); !strings.Contains(out, "déjà attribué") {
		t.Fatal("duplicate ID accepted:", out)
	}
	var n int
	var last string
	s.db.QueryRow(`SELECT COUNT(*) FROM hardware_items WHERE parent_id = 1 AND status = 'in_use'`).Scan(&n)
	s.db.QueryRow(`SELECT hl_id FROM hardware_items WHERE name = 'Câble'`).Scan(&last)
	if n != 4 || last != "HL-0101" {
		t.Fatalf("components %d (want cpu, ram, disk, nic), next ID %q", n, last)
	}
	var ram float64
	s.db.QueryRow(`SELECT capacity_gb FROM hardware_items WHERE category = 'ram'`).Scan(&ram)
	if ram != 64 {
		t.Fatalf("RAM %v", ram)
	}
}

// A physical deployment runs on a stock machine: promoting it creates the inventory item from the
// machine's components and links the machine to it; fields of other kinds are dropped.
func TestPhysicalDeploymentFromStock(t *testing.T) {
	s, ts, tok := newMgTestServer(t)
	ok := func(out string) {
		t.Helper()
		if !strings.Contains(out, `"ok":true`) {
			t.Fatal(out)
		}
	}
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"R730"}, "category": {"server"}, "status": {"stock"}, "brand": {"Dell"}}))
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"DDR4 32 Go"}, "category": {"ram"}, "status": {"stock"}, "parent_id": {"1"}, "capacity_gb": {"32"}, "quantity": {"2"}}))
	ok(postForm(t, ts, tok, "/api/mg/hardware", url.Values{"name": {"Switch 24p"}, "category": {"switch"}, "status": {"stock"}}))
	postForm(t, ts, tok, "/api/mg/deployments", url.Values{"title": {"pve-02"}, "kind": {"physical"}, "status": {"done"}, "priority": {"medium"},
		"hardware_id": {"1"}, "vmid": {"100"}, "steps": {"[]"}})
	var vmid any
	var hw int64
	s.db.QueryRow(`SELECT vmid, hardware_id FROM deployments WHERE id = 1`).Scan(&vmid, &hw)
	if vmid != nil || hw != 1 {
		t.Fatalf("physical deployment: vmid %v, hardware %d", vmid, hw)
	}
	postForm(t, ts, tok, "/api/mg/deployments/1/promote", url.Values{})
	var ram float64
	var maker string
	var linked int64
	s.db.QueryRow(`SELECT ram_gb, manufacturer FROM assets WHERE display_name = 'pve-02'`).Scan(&ram, &maker)
	s.db.QueryRow(`SELECT asset_id FROM hardware_items WHERE id = 1`).Scan(&linked)
	if ram != 64 || maker != "Dell" || linked == 0 {
		t.Fatalf("promoted: ram %v, maker %q, machine linked to %d", ram, maker, linked)
	}
}
