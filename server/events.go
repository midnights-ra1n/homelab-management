package main

// Live updates as Server-Sent Events: /api/events for the web UI (session) and /api/v1/events
// for the apps (token, status:read). An event only names what changed, never the data, so
// a client reloads the view concerned instead of polling it; the stream carries nothing
// that the scopes of the token would not show anyway.
//
// Topics:
//   - hosts:    a host's status, agent info, updates, disks, containers or action changed;
//   - monitors: a monitor's status changed;
//   - metrics:  new measures (agent report, probe result): numbers only, frequent;
//   - all:      a write from the UI or the API (anything may have changed).

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

const (
	maxEventClients = 200
	eventFlushEvery = time.Second // topics of one second are sent together
	eventHeartbeat  = 25 * time.Second
)

type eventBus struct {
	mu   sync.Mutex
	subs map[chan string]struct{}
}

var events = &eventBus{subs: map[chan string]struct{}{}}

// publish never blocks: a client too slow to drain its buffer simply misses the topic,
// and the next flush or its safety reload catches up.
func (b *eventBus) publish(topic string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- topic:
		default:
		}
	}
}

func (b *eventBus) subscribe() (chan string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.subs) >= maxEventClients {
		return nil, false
	}
	ch := make(chan string, 64)
	b.subs[ch] = struct{}{}
	return ch, true
}

func (b *eventBus) unsubscribe(ch chan string) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	ch, ok := events.subscribe()
	if !ok {
		w.Header().Set("Retry-After", "30")
		writeErr(w, http.StatusServiceUnavailable, "Trop de connexions en direct")
		return
	}
	defer events.unsubscribe(ch)
	rc := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no") // nginx: send each event at once
	w.WriteHeader(http.StatusOK)
	// retry: reconnection delay for EventSource; "ready" tells the client to load its data once.
	fmt.Fprint(w, "retry: 5000\nevent: ready\ndata: {}\n\n")
	if rc.Flush() != nil {
		return
	}
	flush := time.NewTicker(eventFlushEvery)
	beat := time.NewTicker(eventHeartbeat)
	defer flush.Stop()
	defer beat.Stop()
	var pending []string
	for {
		select {
		case <-r.Context().Done():
			return
		case t := <-ch:
			if !slices.Contains(pending, t) {
				pending = append(pending, t)
			}
			continue
		case <-beat.C:
			fmt.Fprint(w, ": ping\n\n") // keeps proxies from closing an idle stream
		case <-flush.C:
			if len(pending) == 0 {
				continue
			}
			slices.Sort(pending)
			fmt.Fprintf(w, "event: changed\ndata: {\"topics\":[\"%s\"]}\n\n", strings.Join(pending, `","`))
			pending = pending[:0]
		}
		if rc.Flush() != nil {
			return
		}
	}
}
