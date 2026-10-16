package main

// Real state of the inventory items: one ICMP echo to the primary address every minute.
// Items linked to a monitored host take their state from the monitoring sync instead, and
// manual states (maintenance, planned, decommissioned) are never overwritten.

import (
	"context"
	"log/slog"
	"net"
	"os"
	"sync"
	"time"

	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
)

func (s *Server) runAssetStatus(ctx context.Context) {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		s.refreshAssetStatuses(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Server) refreshAssetStatuses(ctx context.Context) {
	rows, err := s.rows(`SELECT a.id, (SELECT address FROM ip_addresses WHERE asset_id = a.id ORDER BY is_primary DESC, id LIMIT 1) AS ip
	   FROM assets a WHERE a.status IN ('online','offline') AND a.hlm_host_id IS NULL`)
	if err != nil {
		slog.Error("asset status", "err", err)
		return
	}
	type result struct {
		id     int64
		online bool
	}
	var results []result
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 16) // bounded number of probes in flight
	for _, r := range rows {
		ip, _ := r["ip"].(string)
		if ip == "" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			up, usable := ping(ctx, ip, 2*time.Second)
			<-sem
			if !usable {
				return
			}
			mu.Lock()
			results = append(results, result{r["id"].(int64), up})
			mu.Unlock()
		}()
	}
	wg.Wait()
	tx, err := s.db.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()
	for _, r := range results {
		st := "offline"
		if r.online {
			st = "online"
		}
		// The state is filtered again: the item may have been set to maintenance meanwhile.
		tx.Exec(`UPDATE assets SET status = ?, status_source = 'ping', status_checked_at = datetime('now')
		   WHERE id = ? AND status IN ('online','offline') AND hlm_host_id IS NULL`, st, r.id)
	}
	// Address removed: the state is manual again.
	tx.Exec(`UPDATE assets SET status_source = '', status_checked_at = NULL WHERE status_source = 'ping'
	   AND NOT EXISTS (SELECT 1 FROM ip_addresses WHERE asset_id = assets.id)`)
	tx.Commit()
}

var pingWarn sync.Once

// ping sends one unprivileged ICMP echo (net.ipv4.ping_group_range, allowed by default on
// Debian and in Docker). usable is false when ICMP cannot be used: the state then stays as is.
func ping(ctx context.Context, ip string, timeout time.Duration) (up, usable bool) {
	dst := net.ParseIP(ip).To4()
	if dst == nil {
		return false, false
	}
	c, err := icmp.ListenPacket("udp4", "0.0.0.0")
	if err != nil {
		pingWarn.Do(func() {
			slog.Warn("ICMP unavailable (net.ipv4.ping_group_range): inventory states stay manual", "err", err)
		})
		return false, false
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(timeout))
	seq := int(time.Now().UnixNano() & 0xffff)
	msg := icmp.Message{Type: ipv4.ICMPTypeEcho, Body: &icmp.Echo{ID: os.Getpid() & 0xffff, Seq: seq, Data: []byte("homelab-tools")}}
	b, _ := msg.Marshal(nil)
	if _, err := c.WriteTo(b, &net.UDPAddr{IP: dst}); err != nil {
		return false, true
	}
	buf := make([]byte, 1500)
	for ctx.Err() == nil {
		n, peer, err := c.ReadFrom(buf)
		if err != nil {
			return false, true
		}
		rm, err := icmp.ParseMessage(1, buf[:n])
		if err != nil || rm.Type != ipv4.ICMPTypeEchoReply {
			continue
		}
		// Unprivileged sockets rewrite the echo id; the sequence and the peer identify the reply.
		if e, ok := rm.Body.(*icmp.Echo); ok && e.Seq == seq {
			if u, ok := peer.(*net.UDPAddr); ok && u.IP.Equal(dst) {
				return true, true
			}
		}
	}
	return false, false
}
