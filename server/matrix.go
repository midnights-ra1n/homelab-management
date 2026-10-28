package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

var matrixClient = &http.Client{Timeout: 15 * time.Second}

// matrixMessage turns an alert into a Matrix text body and its HTML form; every value is escaped.
func matrixMessage(title string, d emailData) (string, string) {
	var txt, h strings.Builder
	txt.WriteString(title)
	h.WriteString("<strong>" + html.EscapeString(title) + "</strong><ul>")
	for _, e := range d.Events {
		line := e.Time
		if e.FromLabel != "" {
			line = e.FromLabel + " → " + e.ToLabel + " à " + e.Time
		}
		if e.Message != "" {
			line += " · " + e.Message
		}
		fmt.Fprintf(&txt, "\n• [%s] %s (%s) : %s", e.ToLabel, e.Name, e.Kind, line)
		fmt.Fprintf(&h, `<li><font color="%s"><strong>%s</strong></font> %s (%s)<br>%s</li>`,
			e.Color, html.EscapeString(e.ToLabel), html.EscapeString(e.Name), html.EscapeString(e.Kind), html.EscapeString(line))
	}
	h.WriteString("</ul>")
	if d.URL != "" {
		txt.WriteString("\n" + d.URL)
		h.WriteString(`<a href="` + html.EscapeString(d.URL) + `">Ouvrir le tableau de bord</a>`)
	}
	return txt.String(), h.String()
}

func (s *Server) sendMatrixAlert(evs []Event, prefix string) error {
	d := s.emailData(evs)
	subj, _, err := s.renderConfiguredAlert(d)
	if err != nil {
		return err
	}
	txt, h := matrixMessage(prefix+subj, d)
	return s.sendMatrix(txt, h)
}

// sendMatrix posts a message with the client-server API to the configured homeserver,
// which can be any node (matrix.org or self-hosted). The token's account must have joined the room.
func (s *Server) sendMatrix(text, htmlBody string) error {
	hs := strings.TrimRight(s.getSetting("matrix_homeserver", ""), "/")
	token, room := s.getSetting("matrix_token", ""), s.getSetting("matrix_room", "")
	if hs == "" || token == "" || room == "" {
		return errors.New("Matrix non configuré : renseignez le serveur, le jeton et le salon")
	}
	body, _ := json.Marshal(map[string]string{"msgtype": "m.text", "body": text, "format": "org.matrix.custom.html", "formatted_body": htmlBody})
	u := hs + "/_matrix/client/v3/rooms/" + url.PathEscape(room) + "/send/m.room.message/hlm" + strconv.FormatInt(time.Now().UnixNano(), 10)
	req, err := http.NewRequest(http.MethodPut, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := matrixClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error string `json:"error"`
		}
		json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&e)
		return fmt.Errorf("Matrix a répondu %d %s", resp.StatusCode, e.Error)
	}
	return nil
}

func (s *Server) handleTestMatrix(w http.ResponseWriter, r *http.Request) {
	if err := s.sendMatrixAlert(sampleEvents(), "[Test] "); err != nil {
		writeErr(w, 502, "Échec de l'envoi : "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
