package main

// Pacing of the e-mail and Matrix alerts. Each kind of alert is sent at once or gathered in a
// digest (hourly, daily, weekly, monthly, at a set time); instant messages can be capped per
// hour and per object (a flapping service). Deferred events wait in notify_queue, so a restart
// loses nothing. Push notifications stay instant. Also: the daily update check of every agent.

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"
)

// KindPending lists the updates waiting on a host, in an updates digest.
const KindPending = "Mises à jour en attente"

// notifyCategory groups the event kinds the way the settings page shows them (notify_freq_<category>).
var notifyCategory = map[string]string{
	"Hôte": "status", "Sonde": "status", KindCert: "cert", KindDisk: "disk", KindSpace: "disk",
	KindUpdates: "updates", KindReboot: "updates", KindPending: "updates",
	KindImage: "docker", KindNodeApp: "nodeapps", KindReminder: "reminders",
}

var notifyFreqs = []string{"instant", "hourly", "daily", "weekly", "monthly"}

func (s *Server) notifyFreq(kind string) string {
	cat, ok := notifyCategory[kind]
	if !ok {
		return "instant"
	}
	return s.getSetting("notify_freq_"+cat, "instant")
}

// pace returns the events to send now and queues the others: their category is sent as a
// digest, or the hourly cap or the per-object cooldown is reached (they go to the hourly digest).
func (n *Notifier) pace(evs []Event, now time.Time) []Event {
	s := n.s
	maxHour, _ := strconv.Atoi(s.getSetting("notify_max_per_hour", "0"))
	cool, _ := strconv.Atoi(s.getSetting("notify_cooldown_min", "0"))
	n.mu.Lock()
	defer n.mu.Unlock()
	n.sent = slices.DeleteFunc(n.sent, func(t time.Time) bool { return now.Sub(t) >= time.Hour })
	capped := maxHour > 0 && len(n.sent) >= maxHour
	var out []Event
	for _, e := range evs {
		freq, key := s.notifyFreq(e.Kind), e.Kind+"\x00"+e.Name
		switch {
		case freq == "instant" && !capped && (cool == 0 || now.Sub(n.last[key]) >= time.Duration(cool)*time.Minute):
			out = append(out, e)
			n.last[key] = now
		case freq != "instant" && notifyCategory[e.Kind] == "updates":
			// Not queued: the updates digest lists what is still pending on each host when it is sent.
		default:
			if freq == "instant" {
				freq = "hourly"
			}
			if _, err := s.db.Exec(`INSERT INTO notify_queue(freq,kind,name,from_s,to_s,message,at,from_text,to_text) VALUES(?,?,?,?,?,?,?,?,?)`,
				freq, e.Kind, e.Name, e.From, e.To, e.Message, e.At.Unix(), e.FromText, e.ToText); err != nil {
				slog.Error("queue alert", "err", err)
			}
		}
	}
	if len(out) > 0 {
		n.sent = append(n.sent, now)
	}
	return out
}

// digestSlot is the latest scheduled time at or before now: the top of the hour, or hhmm
// every day, every week on weekday (1 Monday … 7 Sunday), every month on monthday (1-28).
func digestSlot(freq string, now time.Time, hhmm string, weekday, monthday int) time.Time {
	h, m := 8, 0
	fmt.Sscanf(hhmm, "%d:%d", &h, &m)
	y, mo, d := now.Date()
	t := time.Date(y, mo, d, h, m, 0, 0, now.Location())
	switch freq {
	case "hourly":
		return time.Date(y, mo, d, now.Hour(), 0, 0, 0, now.Location())
	case "weekly":
		t = t.AddDate(0, 0, -((int(now.Weekday())-weekday%7)+7)%7)
		if t.After(now) {
			t = t.AddDate(0, 0, -7)
		}
	case "monthly":
		t = time.Date(y, mo, monthday, h, m, 0, 0, now.Location())
		if t.After(now) {
			t = time.Date(y, mo-1, monthday, h, m, 0, 0, now.Location())
		}
	default: // daily
		if t.After(now) {
			t = t.AddDate(0, 0, -1)
		}
	}
	return t
}

// due tells whether the slot of a schedule has passed since its last run (recorded in settings).
// The first time, nothing is due: a fresh server does not send a digest at once.
func (s *Server) due(key, freq, hhmm string, now time.Time) bool {
	wd, _ := strconv.Atoi(s.getSetting("notify_digest_weekday", "1"))
	md, _ := strconv.Atoi(s.getSetting("notify_digest_monthday", "1"))
	last, err := strconv.ParseInt(s.getSetting(key, ""), 10, 64)
	if err != nil {
		s.setSetting(key, strconv.FormatInt(now.Unix(), 10))
		return false
	}
	if last >= digestSlot(freq, now, hhmm, wd, md).Unix() {
		return false
	}
	s.setSetting(key, strconv.FormatInt(now.Unix(), 10))
	return true
}

func (s *Server) runSchedules(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		now := time.Now().In(localTZ())
		hhmm := s.getSetting("notify_digest_time", "08:00")
		for _, f := range notifyFreqs[1:] {
			if s.due("digest_last_"+f, f, hhmm, now) {
				s.sendDigest(f)
			}
		}
		if at := s.getSetting("updates_check_time", ""); at != "" && s.due("updates_check_last", "daily", at, now) {
			s.checkAllUpdates()
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// sendDigest sends the events queued for freq, plus the pending updates when that is the
// frequency of the updates alerts.
func (s *Server) sendDigest(freq string) {
	rows, err := s.db.Query(`SELECT id,kind,name,from_s,to_s,message,at,from_text,to_text FROM notify_queue WHERE freq=? ORDER BY id`, freq)
	if err != nil {
		slog.Error("digest", "err", err)
		return
	}
	var evs []Event
	var maxID int64
	for rows.Next() {
		var e Event
		var at int64
		if rows.Scan(&maxID, &e.Kind, &e.Name, &e.From, &e.To, &e.Message, &at, &e.FromText, &e.ToText) == nil {
			e.At = time.Unix(at, 0)
			evs = append(evs, e)
		}
	}
	rows.Close()
	if maxID > 0 {
		s.db.Exec(`DELETE FROM notify_queue WHERE freq=? AND id<=?`, freq, maxID)
	}
	if s.getSetting("notify_freq_updates", "instant") == freq {
		evs = append(evs, s.pendingUpdateEvents()...)
	}
	if len(evs) > 0 {
		slog.Info("digest", "freq", freq, "events", len(evs))
		s.sendMessages(evs)
	}
}

// pendingUpdateEvents describes, host by host, the updates still waiting and the reboots required.
func (s *Server) pendingUpdateEvents() []Event {
	hosts, err := s.loadHosts("")
	if err != nil {
		slog.Error("updates digest", "err", err)
		return nil
	}
	sec, reboot := s.getSetting("notify_security_updates", "true") == "true", s.getSetting("notify_reboot", "true") == "true"
	var out []Event
	for _, h := range hosts {
		u := h.Updates
		if u == nil {
			continue
		}
		var parts []string
		if sec && u.Pending > 0 {
			parts = append(parts, plural(fmt.Sprintf("%d paquet(s) à mettre à jour, dont %d de sécurité", u.Pending, u.Security)))
		}
		if reboot && u.RebootRequired {
			parts = append(parts, "redémarrage requis")
		}
		if len(parts) > 0 {
			out = append(out, Event{Kind: KindPending, Name: h.Name, Message: strings.Join(parts, " · "), At: time.Unix(u.CheckedAt, 0)})
		}
	}
	return out
}

// checkAllUpdates asks every connected agent to refresh its package lists (apt-get update) and
// report its pending updates, like the "Tout vérifier" button.
func (s *Server) checkAllUpdates() {
	hosts, err := s.loadHosts("")
	if err != nil {
		slog.Error("scheduled updates check", "err", err)
		return
	}
	n := 0
	for _, h := range hosts {
		if h.Connected && !actionBusy(h.Action) && s.agentSend(h.ID, map[string]string{"type": "action", "action": "check_updates"}) == nil {
			s.setHostAction(h.ID, "check_updates", "pending", "")
			n++
		}
	}
	events.publish("hosts")
	s.logEvent("planification", "host", 0, "action", plural(fmt.Sprintf("Vérification planifiée des mises à jour sur %d hôte(s)", n)))
}
