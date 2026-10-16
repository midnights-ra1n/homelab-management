package main

// Webmin instances: web UI reachability plus, over key-based SSH, the system state
// (port of lib/integrations/webmin.ts). Everything is read-only.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// webminScript is POSIX sh: Debian/Ubuntu, RHEL/Alma/Rocky, Alpine.
const webminScript = `
echo "hostname=$(hostname 2>/dev/null)"
[ -r /etc/os-release ] && . /etc/os-release && echo "os=$PRETTY_NAME"
echo "kernel=$(uname -r)"
echo "uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
echo "cpus=$(nproc 2>/dev/null)"
awk '/^MemTotal:/{t=$2}/^MemAvailable:/{a=$2}END{if(t){print "mem_total="t*1024; print "mem_used="(t-a)*1024}}' /proc/meminfo 2>/dev/null
df -Pk / 2>/dev/null | awk 'NR==2{print "disk_total="$2*1024; print "disk_used="$3*1024}'
for f in /etc/webmin/version /usr/share/webmin/version /usr/libexec/webmin/version /opt/webmin/version; do
  [ -r "$f" ] && { echo "webmin_version=$(cat "$f")"; break; }
done
command -v systemctl >/dev/null 2>&1 && echo "webmin_service=$(systemctl is-active webmin 2>/dev/null)"
[ -f /var/run/reboot-required ] && echo "reboot=1"
if command -v apt-get >/dev/null 2>&1; then
  echo "updates=$(apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null | grep -c '^Inst ')"
elif command -v dnf >/dev/null 2>&1; then
  echo "updates=$(dnf -q --cacheonly check-update 2>/dev/null | grep -c '^[a-zA-Z0-9]')"
elif command -v apk >/dev/null 2>&1; then
  echo "updates=$(apk version -l '<' 2>/dev/null | tail -n +2 | wc -l)"
fi
`

func parseWebminSystem(stdout string) map[string]any {
	kv := map[string]string{}
	for _, line := range strings.Split(stdout, "\n") {
		if k, v, ok := strings.Cut(line, "="); ok && strings.TrimSpace(k) != "" {
			kv[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	num := func(k string) any {
		if f, err := strconv.ParseFloat(kv[k], 64); err == nil {
			return f
		}
		return nil
	}
	var load any
	if p := strings.Fields(kv["load"]); len(p) == 3 {
		l := make([]float64, 3)
		ok := true
		for i, x := range p {
			f, err := strconv.ParseFloat(x, 64)
			ok = ok && err == nil
			l[i] = f
		}
		if ok {
			load = l
		}
	}
	return map[string]any{
		"hostname": kv["hostname"], "os": kv["os"], "kernel": kv["kernel"], "uptime": num("uptime"), "load": load,
		"cpus": num("cpus"), "memTotal": num("mem_total"), "memUsed": num("mem_used"), "diskTotal": num("disk_total"),
		"diskUsed": num("disk_used"), "webminVersion": kv["webmin_version"], "webminService": kv["webmin_service"],
		"updates": num("updates"), "rebootRequired": kv["reboot"] == "1",
	}
}

func (s *Server) webminInstance(ctx context.Context, i *integration) (map[string]any, error) {
	c := i.Config
	hasSSH := c.SSHKeyID > 0 && c.SSHUser != ""
	out := map[string]any{"ssh": hasSSH}
	web := make(chan probeResult, 1)
	go func() { web <- probeURL(ctx, i.URL, 4*time.Second) }()
	if hasSSH {
		signer, err := s.privateKey(c.SSHKeyID)
		if err == nil {
			port := c.SSHPort
			if port == 0 {
				port = 22
			}
			u, _ := url.Parse(i.URL)
			var stdout, seen string
			stdout, seen, err = sshExec(ctx, u.Hostname(), port, c.SSHUser, signer, c.SSHHostKey, webminScript)
			if err == nil {
				out["system"] = parseWebminSystem(stdout)
				if c.SSHHostKey == "" && i.ID > 0 && seen != "" {
					s.rememberHostKey(i.ID, seen)
				}
			}
		}
		if err != nil {
			out["sshError"] = err.Error()
		}
	}
	out["web"] = <-web
	return out, nil
}

func (s *Server) rememberHostKey(id int64, fp string) {
	list, err := s.loadIntegrations(`WHERE id = ?`, id)
	if err != nil || len(list) == 0 || list[0].Config.SSHHostKey != "" {
		return
	}
	c := list[0].Config
	c.SSHHostKey = fp
	b, _ := json.Marshal(c)
	s.db.Exec(`UPDATE integrations SET config = ? WHERE id = ?`, s.encrypt(string(b)), id)
}

func (s *Server) testWebmin(ctx context.Context, i *integration) (string, error) {
	r, _ := s.webminInstance(ctx, i)
	web := r["web"].(probeResult)
	sys, _ := r["system"].(map[string]any)
	sshErr, _ := r["sshError"].(string)
	if !web.Up && sys == nil {
		if sshErr != "" {
			return "", integrationErr(sshErr)
		}
		return "", integrationErr("Interface Webmin injoignable")
	}
	state := "injoignable"
	if web.Up {
		state = "joignable"
	}
	if sshErr != "" {
		return "", integrationErr("Interface web " + state + ", mais " + sshErr)
	}
	webMsg := "interface web injoignable"
	if web.Up {
		webMsg = "interface joignable (" + strconv.Itoa(web.MS) + " ms)"
	}
	if sys == nil {
		return "Webmin : " + webMsg + " (SSH non configuré)", nil
	}
	host, _ := sys["hostname"].(string)
	if host == "" {
		host = "Hôte"
	}
	ver, _ := sys["webminVersion"].(string)
	if ver == "" {
		ver = "?"
	}
	return host + " — Webmin " + ver + ", " + webMsg, nil
}

func (s *Server) mgWebmin(w http.ResponseWriter, r *http.Request) {
	list, err := s.loadIntegrations(`WHERE type = 'webmin' AND enabled = 1`)
	if err != nil {
		serverErr(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	writeJSON(w, 200, collect(ctx, list, s.webminInstance))
}
