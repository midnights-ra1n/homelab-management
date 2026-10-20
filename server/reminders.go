package main

// Update reminders, shared by both roles: "update this host on that day", once or every N days.
// They show in the notifications menu once due; marking one done moves it to its next date.

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const remindersTable = `CREATE TABLE IF NOT EXISTS update_reminders (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	host        TEXT NOT NULL,
	due_date    TEXT NOT NULL,
	repeat_days INTEGER NOT NULL DEFAULT 0,
	note        TEXT NOT NULL DEFAULT '',
	created_at  TEXT NOT NULL DEFAULT (datetime('now')),
	updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);`

// remindersRef ties a reminder to the host's id in its feed ("h12" in the monitoring, "source:id"
// in the management), so a renamed host keeps its reminders; notified_on is the due date already sent.
const remindersRef = `ALTER TABLE update_reminders ADD COLUMN host_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE update_reminders ADD COLUMN notified_on TEXT NOT NULL DEFAULT '';`

// KindReminder events announce a due update reminder (push and e-mail, monitoring only).
const KindReminder = "Rappel"

type reminderIn struct {
	Host       string `json:"host"`
	HostRef    string `json:"host_ref"`
	DueDate    string `json:"due_date"`
	RepeatDays int    `json:"repeat_days"`
	Note       string `json:"note"`
}

// valid trims the fields and returns the first error message, "" when the reminder is valid.
func (in *reminderIn) valid() string {
	in.Host, in.HostRef, in.Note = strings.TrimSpace(in.Host), strings.TrimSpace(in.HostRef), strings.TrimSpace(in.Note)
	switch {
	case in.Host == "" || utf8.RuneCountInString(in.Host) > 200 || len(in.HostRef) > 200:
		return "Choisissez un hôte"
	case in.RepeatDays < 0 || in.RepeatDays > 366:
		return "La répétition va de 0 à 366 jours"
	case utf8.RuneCountInString(in.Note) > 500:
		return "500 caractères maximum pour la note"
	}
	if _, err := time.Parse(time.DateOnly, in.DueDate); err != nil {
		return "Date invalide"
	}
	return ""
}

func today() string { return time.Now().In(localTZ()).Format(time.DateOnly) }

func (s *Server) handleListReminders(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, host, host_ref, due_date, repeat_days, note FROM update_reminders ORDER BY due_date, host`)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	type reminder struct {
		ID         int64  `json:"id"`
		Host       string `json:"host"`
		HostRef    string `json:"host_ref"`
		DueDate    string `json:"due_date"`
		RepeatDays int    `json:"repeat_days"`
		Note       string `json:"note"`
		Due        bool   `json:"due"`
	}
	out := []reminder{}
	now := today()
	for rows.Next() {
		var x reminder
		if err := rows.Scan(&x.ID, &x.Host, &x.HostRef, &x.DueDate, &x.RepeatDays, &x.Note); err != nil {
			serverErr(w, err)
			return
		}
		x.Due = x.DueDate <= now
		out = append(out, x)
	}
	writeJSON(w, 200, map[string]any{"today": now, "reminders": out})
}

func (s *Server) handleSaveReminder(w http.ResponseWriter, r *http.Request) {
	var in reminderIn
	if !readJSON(w, r, &in) {
		return
	}
	if msg := in.valid(); msg != "" {
		writeErr(w, 400, msg)
		return
	}
	logName(r, in.Host)
	if r.PathValue("id") == "" {
		res, err := s.db.Exec(`INSERT INTO update_reminders(host, host_ref, due_date, repeat_days, note) VALUES(?,?,?,?,?)`, in.Host, in.HostRef, in.DueDate, in.RepeatDays, in.Note)
		if err != nil {
			serverErr(w, err)
			return
		}
		id, _ := res.LastInsertId()
		writeJSON(w, 201, map[string]int64{"id": id})
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	res, err := s.db.Exec(`UPDATE update_reminders SET host=?, host_ref=?, due_date=?, repeat_days=?, note=?, notified_on='', updated_at=datetime('now') WHERE id=?`,
		in.Host, in.HostRef, in.DueDate, in.RepeatDays, in.Note, id)
	if err != nil {
		serverErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, 404, "Rappel introuvable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleReminderDone moves a repeating reminder to today + its period, and deletes a one-off one.
func (s *Server) handleReminderDone(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var host string
	var repeat int
	if err := s.db.QueryRow(`SELECT host, repeat_days FROM update_reminders WHERE id=?`, id).Scan(&host, &repeat); errors.Is(err, sql.ErrNoRows) {
		writeErr(w, 404, "Rappel introuvable")
		return
	} else if err != nil {
		serverErr(w, err)
		return
	}
	logName(r, host)
	var next any // null: one-off reminder, deleted
	var err error
	if repeat > 0 {
		next = time.Now().In(localTZ()).AddDate(0, 0, repeat).Format(time.DateOnly)
		_, err = s.db.Exec(`UPDATE update_reminders SET due_date=?, notified_on='', updated_at=datetime('now') WHERE id=?`, next, id)
	} else {
		_, err = s.db.Exec(`DELETE FROM update_reminders WHERE id=?`, id)
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"next_due": next})
}

func (s *Server) handleDeleteReminder(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var host string
	if s.db.QueryRow(`SELECT host FROM update_reminders WHERE id=?`, id).Scan(&host) != nil {
		writeErr(w, 404, "Rappel introuvable")
		return
	}
	logName(r, host)
	if _, err := s.db.Exec(`DELETE FROM update_reminders WHERE id=?`, id); err != nil {
		serverErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// runReminders sends each due reminder once through the alert channels (push, e-mail), monitoring only.
func (s *Server) runReminders(ctx context.Context) {
	t := time.NewTicker(15 * time.Minute)
	defer t.Stop()
	for {
		s.notifyReminders()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Server) notifyReminders() {
	// The host's current name when its ref still matches one ("h12"), else the name saved with it.
	rows, err := s.db.Query(`SELECT r.id, r.due_date, r.note, COALESCE((SELECT h.name FROM hosts h WHERE 'h' || h.id = r.host_ref), r.host)
		FROM update_reminders r WHERE r.due_date <= ? AND r.notified_on <> r.due_date`, today())
	if err != nil {
		slog.Error("reminders", "err", err)
		return
	}
	type due struct {
		id               int64
		date, note, host string
	}
	var list []due
	for rows.Next() {
		var d due
		if rows.Scan(&d.id, &d.date, &d.note, &d.host) == nil {
			list = append(list, d)
		}
	}
	rows.Close()
	for _, d := range list {
		msg := "Mise à jour prévue le " + d.date
		if d.note != "" {
			msg += " · " + d.note
		}
		s.notifier.add(Event{Kind: KindReminder, Name: d.host, Message: msg, At: time.Now()})
		s.db.Exec(`UPDATE update_reminders SET notified_on=? WHERE id=?`, d.date, d.id)
	}
}
