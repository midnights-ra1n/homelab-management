package main

// Bandwidth: the SNMP probes that read an interface (throughput in / out, link state) grouped
// by device and interface. The monitoring page, both dashboards and /api/v1/bandwidth (read
// by the management role) all use this one view, so they always show the same numbers.

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type bandwidthSide struct {
	MonitorID int64      `json:"monitor_id"`
	Name      string     `json:"name"`
	Status    string     `json:"status"`
	Message   string     `json:"message"`
	Current   *float64   `json:"current_mbps"` // last reading
	Avg       *float64   `json:"avg_mbps"`     // over the range
	Peak      *float64   `json:"peak_mbps"`    // highest bucket average over the range
	Series    []*float64 `json:"series"`       // Mbit/s, aligned on bandwidthView.T
	Today     int64      `json:"today_octets"` // traffic volume since local midnight
	Month     int64      `json:"month_octets"` // since the 1st of the month
	Daily     []int64    `json:"daily_octets"` // per local day, aligned on bandwidthView.Days
}

type bandwidthState struct {
	MonitorID int64  `json:"monitor_id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Message   string `json:"message"`
}

type bandwidthLink struct {
	Target    string          `json:"target"`
	Interface string          `json:"interface"`
	Status    string          `json:"status"`     // worst status of the link's probes
	Speed     *float64        `json:"speed_mbps"` // link speed reported by the device (ifHighSpeed)
	In        *bandwidthSide  `json:"in"`
	Out       *bandwidthSide  `json:"out"`
	State     *bandwidthState `json:"state"` // ifstatus probe, e.g. a WireGuard tunnel
}

type bandwidthView struct {
	Range string          `json:"range"`
	T     []int64         `json:"t"`    // bucket starts, unix seconds
	Days  []int64         `json:"days"` // the last bandwidthDays local midnights, unix seconds
	Links []bandwidthLink `json:"links"`
}

const (
	bandwidthPoints = 120
	bandwidthDays   = 31
)

func (s *Server) bandwidth(rng time.Duration, label string) (*bandwidthView, error) {
	mons, err := s.loadMonitors(`WHERE enabled=1 AND type='snmp' AND json_extract(config,'$.snmp_mode') IN ('in','out','ifstatus')`)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	bucket := max(rng.Milliseconds()/bandwidthPoints, 60_000)
	from := (now.Add(-rng).UnixMilli() / bucket) * bucket
	v := &bandwidthView{Range: label, T: []int64{}, Links: []bandwidthLink{}}
	for t := from; t <= now.UnixMilli(); t += bucket {
		v.T = append(v.T, t/1000)
	}
	y, mo, d := now.In(localTZ()).Date()
	today := time.Date(y, mo, d, 0, 0, 0, 0, localTZ())
	for i := bandwidthDays - 1; i >= 0; i-- {
		v.Days = append(v.Days, today.AddDate(0, 0, -i).Unix())
	}
	byKey := map[string]*bandwidthLink{}
	var keys []string
	for _, m := range mons {
		key := strings.ToLower(m.Target + "|" + m.Config.Interface)
		l := byKey[key]
		if l == nil {
			l = &bandwidthLink{Target: m.Target, Interface: m.Config.Interface, Status: StatusUnknown}
			if sp, ok := ifSpeeds.Load(key); ok {
				f := sp.(float64)
				l.Speed = &f
			}
			byKey[key] = l
			keys = append(keys, key)
		}
		if statusRank(m.Status) > statusRank(l.Status) || l.Status == StatusUnknown {
			l.Status = m.Status
		}
		if m.Config.SNMPMode == "ifstatus" {
			l.State = &bandwidthState{m.ID, m.Name, m.Status, m.Message}
			continue
		}
		side, err := s.bandwidthSide(&m, from, bucket, len(v.T))
		if err == nil {
			err = s.trafficVolume(side, v.Days, time.Date(y, mo, 1, 0, 0, 0, 0, localTZ()).Unix())
		}
		if err != nil {
			return nil, err
		}
		if m.Config.SNMPMode == "in" {
			l.In = side
		} else {
			l.Out = side
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		v.Links = append(v.Links, *byKey[k])
	}
	return v, nil
}

func (s *Server) bandwidthSide(m *Monitor, from, bucket int64, n int) (*bandwidthSide, error) {
	side := &bandwidthSide{MonitorID: m.ID, Name: m.Name, Status: m.Status, Message: m.Message, Series: make([]*float64, n)}
	rows, err := s.db.Query(`SELECT (ts-?1)/?2, AVG(value) FROM monitor_results WHERE monitor_id=?3 AND ts>=?1 AND value IS NOT NULL GROUP BY 1`, from, bucket, m.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var i int
		var avg float64
		if err := rows.Scan(&i, &avg); err != nil {
			return nil, err
		}
		if i >= 0 && i < n {
			side.Series[i] = &avg
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// The peak is the highest single reading, not a bucket average that would flatten it over 30 days.
	err = s.db.QueryRow(`SELECT AVG(value), MAX(value), (SELECT value FROM monitor_results WHERE monitor_id=?1 AND value IS NOT NULL ORDER BY ts DESC LIMIT 1)
		FROM monitor_results WHERE monitor_id=?1 AND ts>=?2 AND value IS NOT NULL`, m.ID, from).Scan(&side.Avg, &side.Peak, &side.Current)
	return side, err
}

// trafficVolume fills today's, the month's and the daily volumes from traffic_hourly, grouped by
// local day (hours, so days and months start at the local midnight in whole-hour timezones).
func (s *Server) trafficVolume(side *bandwidthSide, days []int64, monthStart int64) error {
	side.Daily = make([]int64, len(days))
	rows, err := s.db.Query(`SELECT hour, octets FROM traffic_hourly WHERE monitor_id=? AND hour>=?`, side.MonitorID, min(days[0], monthStart))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var hour, n int64
		if err := rows.Scan(&hour, &n); err != nil {
			return err
		}
		if i := sort.Search(len(days), func(i int) bool { return days[i] > hour }) - 1; i >= 0 {
			side.Daily[i] += n
		}
		if hour >= days[len(days)-1] {
			side.Today += n
		}
		if hour >= monthStart {
			side.Month += n
		}
	}
	return rows.Err()
}

func (s *Server) handleBandwidth(w http.ResponseWriter, r *http.Request) {
	label := r.URL.Query().Get("range")
	if label == "" {
		label = "24h"
	}
	v, err := s.bandwidth(rangeParam(r), label)
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, v)
}

/* ---------- Live view: the device is read on demand, every couple of seconds ---------- */

type liveSample struct {
	MonitorID int64    `json:"monitor_id"`
	Mode      string   `json:"mode"`            // in or out
	Mbps      *float64 `json:"mbps"`            // nil on the very first read or on error
	Error     string   `json:"error,omitempty"` // French, for display
}

type liveView struct {
	At      int64        `json:"at"` // unix milliseconds of the reading
	Samples []liveSample `json:"samples"`
}

// liveMinGap shares one reading between every open page (monitoring, management, apps), so
// the router is never queried more often than this whatever the number of viewers.
const liveMinGap = 1500 * time.Millisecond

var live struct {
	sync.Mutex
	at   time.Time
	view *liveView
	prev map[int64]octetSample // last live counter of each probe
}

func (s *Server) liveBandwidth(ctx context.Context) (*liveView, error) {
	live.Lock()
	defer live.Unlock()
	if live.view != nil && time.Since(live.at) < liveMinGap {
		return live.view, nil
	}
	mons, err := s.loadMonitors(`WHERE enabled=1 AND type='snmp' AND json_extract(config,'$.snmp_mode') IN ('in','out')`)
	if err != nil {
		return nil, err
	}
	// One session and one request per device: in and out are read at the same instant, and
	// SNMPv3 does its engine discovery once.
	groups := map[string][]int{}
	for i := range mons {
		c := &mons[i].Config
		k := strings.Join([]string{strings.ToLower(mons[i].Target), c.SNMPVersion, c.Community, c.SNMPUser, c.AuthProto, c.AuthPass, c.PrivProto, c.PrivPass}, "\x00")
		groups[k] = append(groups[k], i)
	}
	reads := make([]ifReading, len(mons))
	at := make([]time.Time, len(mons))
	var wg sync.WaitGroup
	for _, idx := range groups {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			g := snmpClient(c, &mons[idx[0]], 1200*time.Millisecond)
			if err := g.Connect(); err != nil {
				for _, i := range idx {
					reads[i].fail = &checkResult{StatusMajor, nil, "Connexion SNMP impossible : " + err.Error(), nil, nil, 0}
				}
				return
			}
			defer g.Conn.Close()
			group := make([]*Monitor, len(idx))
			for j, i := range idx {
				group[j] = &mons[i]
			}
			now := time.Now()
			for j, r := range readInterfaces(g, group) {
				reads[idx[j]], at[idx[j]] = r, now
			}
		}()
	}
	wg.Wait()
	prev := live.prev
	live.prev = map[int64]octetSample{}
	last := map[int64]*float64{}
	if live.view != nil {
		for _, o := range live.view.Samples {
			last[o.MonitorID] = o.Mbps
		}
	}
	v := &liveView{At: time.Now().UnixMilli(), Samples: make([]liveSample, len(mons))}
	for i, m := range mons {
		smp := liveSample{MonitorID: m.ID, Mode: m.Config.SNMPMode}
		if f := reads[i].fail; f != nil {
			smp.Error = f.message
		} else {
			p, ok := prev[m.ID]
			if !ok {
				// First live read: start from the probe's last counter rather than showing nothing.
				if pr, found := snmpCounters.Load(counterKey(&m)); found {
					p, ok = pr.(octetSample), true
				}
			}
			smp.Mbps, live.prev[m.ID] = liveRate(p, ok, octetSample{reads[i].n, at[i]}, reads[i].wrap, last[m.ID])
		}
		v.Samples[i] = smp
	}
	live.at, live.view = time.Now(), v
	return v, nil
}

// liveStale: routers such as the Omada ER605 refresh their interface counters only every few
// seconds; an unchanged counter means "not refreshed yet" until this long, then real silence.
const liveStale = 30 * time.Second

// liveRate gives the rate between two counter changes, not two reads (which would show a burst
// then zeros), and the sample to keep as the next reference.
func liveRate(p octetSample, ok bool, r octetSample, wrap uint64, last *float64) (*float64, octetSample) {
	dt := r.at.Sub(p.at)
	delta, _, valid := counterDelta(p.n, r.n, wrap)
	switch {
	case !ok || !valid || dt <= 0:
		return nil, r
	case delta == 0 && dt < liveStale:
		return last, p
	}
	mbps := float64(delta) * 8 / dt.Seconds() / 1e6
	return &mbps, r
}

func (s *Server) handleLiveBandwidth(w http.ResponseWriter, r *http.Request) {
	v, err := s.liveBandwidth(r.Context())
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, v)
}
