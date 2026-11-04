package main

import (
	"testing"
	"time"
)

func TestDigestSlot(t *testing.T) {
	loc := time.FixedZone("CET", 3600)
	now := time.Date(2026, 11, 4, 7, 30, 0, 0, loc) // Wednesday, before 08:00
	for _, c := range []struct {
		freq string
		want time.Time
	}{
		{"hourly", time.Date(2026, 11, 4, 7, 0, 0, 0, loc)},
		{"daily", time.Date(2026, 11, 3, 8, 0, 0, 0, loc)},
		{"weekly", time.Date(2026, 11, 2, 8, 0, 0, 0, loc)}, // Monday
		{"monthly", time.Date(2026, 11, 1, 8, 0, 0, 0, loc)},
	} {
		if got := digestSlot(c.freq, now, "08:00", 1, 1); !got.Equal(c.want) {
			t.Errorf("%s: got %v, want %v", c.freq, got, c.want)
		}
	}
	// Sunday (7) on a Sunday after the time, and a monthly slot still to come this month.
	sun := time.Date(2026, 11, 8, 9, 0, 0, 0, loc)
	if got := digestSlot("weekly", sun, "08:00", 7, 1); !got.Equal(time.Date(2026, 11, 8, 8, 0, 0, 0, loc)) {
		t.Errorf("weekly on Sunday: %v", got)
	}
	jan := time.Date(2026, 1, 3, 9, 0, 0, 0, loc)
	if got := digestSlot("monthly", jan, "08:00", 1, 15); !got.Equal(time.Date(2025, 12, 15, 8, 0, 0, 0, loc)) {
		t.Errorf("monthly across the year: %v", got)
	}
}

func TestPaceQueuesDigestsAndCapsInstantMessages(t *testing.T) {
	s, _ := newTestServer(t)
	s.setSetting("notify_freq_cert", "daily")
	s.setSetting("notify_freq_updates", "monthly")
	s.setSetting("notify_max_per_hour", "1")
	now := time.Now()
	down := Event{Kind: "Sonde", Name: "nas", From: StatusOperational, To: StatusMajor, At: now}
	out := s.notifier.pace([]Event{down, {Kind: KindCert, Name: "cloud"}, {Kind: KindUpdates, Name: "pve"}}, now)
	if len(out) != 1 || out[0].Name != "nas" {
		t.Fatalf("only the outage goes now, got %v", out)
	}
	// Second message within the hour: over the cap, deferred to the hourly digest.
	if out := s.notifier.pace([]Event{down}, now.Add(time.Minute)); len(out) != 0 {
		t.Fatalf("over the cap: %v", out)
	}
	count := func(freq string) (n int) {
		s.db.QueryRow(`SELECT COUNT(*) FROM notify_queue WHERE freq=?`, freq).Scan(&n)
		return
	}
	if count("daily") != 1 || count("hourly") != 1 || count("monthly") != 0 {
		t.Fatalf("queue: daily %d, hourly %d, monthly %d (updates are summarised, not queued)", count("daily"), count("hourly"), count("monthly"))
	}
	s.sendDigest("daily") // nothing configured to send to: still empties its queue
	if count("daily") != 0 || count("hourly") != 1 {
		t.Fatalf("daily digest must take only its own events")
	}

	// Cooldown: the same object is not alerted twice in a row.
	s.setSetting("notify_max_per_hour", "0")
	s.setSetting("notify_cooldown_min", "30")
	up := Event{Kind: "Hôte", Name: "pve", At: now}
	if len(s.notifier.pace([]Event{up}, now)) != 1 || len(s.notifier.pace([]Event{up}, now.Add(5*time.Minute))) != 0 ||
		len(s.notifier.pace([]Event{up}, now.Add(31*time.Minute))) != 1 {
		t.Fatal("cooldown per object not applied")
	}
}

func TestPendingUpdatesDigest(t *testing.T) {
	s, _ := newTestServer(t)
	s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at,updates) VALUES('pve',x'03',0,'{"checked_at":1,"pending":4,"security":1,"reboot_required":true}')`)
	s.db.Exec(`INSERT INTO hosts(name,token_hash,created_at,updates) VALUES('nas',x'04',0,'{"checked_at":1,"pending":0}')`)
	evs := s.pendingUpdateEvents()
	if len(evs) != 1 || evs[0].Name != "pve" || evs[0].Message != "4 paquets à mettre à jour, dont 1 de sécurité · redémarrage requis" {
		t.Fatalf("got %+v", evs)
	}
}

func TestHighPowerWording(t *testing.T) {
	d := buildEmailData("T", "", []Event{{Kind: "Sonde", Name: "baie", From: StatusOperational, To: StatusDegraded, ToText: highPower, At: time.Now()}})
	if e := d.Events[0]; e.ToLabel != "Consommation électrique élevée" || e.FromLabel != "Opérationnel" || d.Warnings != 1 {
		t.Fatalf("got %q → %q", e.FromLabel, e.ToLabel)
	}
}
