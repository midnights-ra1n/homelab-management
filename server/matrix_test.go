package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendMatrixAlert(t *testing.T) {
	s, _ := newTestServer(t)
	var got map[string]string
	var path, auth string
	hs := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, auth = r.URL.EscapedPath(), r.Header.Get("Authorization")
		json.NewDecoder(r.Body).Decode(&got)
		w.Write([]byte(`{"event_id":"$1"}`))
	}))
	defer hs.Close()
	s.setSetting("matrix_homeserver", hs.URL+"/")
	s.setSetting("matrix_token", "tok")
	s.setSetting("matrix_room", "!room:example.fr")
	evs := append(sampleEvents(), Event{Kind: "Sonde", Name: "<b>x</b>", From: StatusOperational, To: StatusMajor})
	if err := s.sendMatrixAlert(evs, ""); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, "/_matrix/client/v3/rooms/%21room:example.fr/send/m.room.message/") || auth != "Bearer tok" {
		t.Fatalf("bad request %s %s", path, auth)
	}
	if !strings.Contains(got["body"], "nextcloud") || strings.Contains(got["formatted_body"], "<b>x") {
		t.Fatalf("bad message %v", got)
	}
	s.setSetting("matrix_token", "")
	if err := s.sendMatrixAlert(evs, ""); err == nil {
		t.Fatal("expected an error without token")
	}
}
