package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"mime"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// gzipMin: below this size gzip's own header eats most of the gain.
const gzipMin = 1024

var gzipPool = sync.Pool{New: func() any { return gzip.NewWriter(nil) }}

func acceptsGzip(r *http.Request) bool {
	for part := range strings.SplitSeq(r.Header.Get("Accept-Encoding"), ",") {
		name, q, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(name), "gzip") {
			return strings.ReplaceAll(strings.TrimSpace(q), " ", "") != "q=0"
		}
	}
	return false
}

func compressible(contentType string) bool {
	t, _, _ := mime.ParseMediaType(contentType)
	switch {
	case t == "text/event-stream": // each event must leave at once
		return false
	case strings.HasPrefix(t, "text/"):
		return true
	}
	return t == "application/json" || t == "application/manifest+json" || t == "application/javascript" || t == "image/svg+xml"
}

// gzipWriter decides at the first byte: the status and the headers are held until then.
type gzipWriter struct {
	http.ResponseWriter
	code    int
	started bool
	gz      *gzip.Writer
}

func (w *gzipWriter) WriteHeader(code int) {
	if w.started || w.code != 0 {
		return
	}
	if code != http.StatusOK { // errors are short; a 206 is already a slice of the file
		w.started = true
		w.ResponseWriter.WriteHeader(code)
		return
	}
	w.code = code
}

func (w *gzipWriter) start(first []byte) {
	w.started = true
	h := w.Header()
	if h.Get("Content-Encoding") == "" && h.Get("Content-Range") == "" && len(first) >= gzipMin && compressible(h.Get("Content-Type")) {
		h.Del("Content-Length")
		h.Set("Content-Encoding", "gzip")
		w.gz = gzipPool.Get().(*gzip.Writer)
		w.gz.Reset(w.ResponseWriter)
	}
	if w.code != 0 {
		w.ResponseWriter.WriteHeader(w.code)
	}
}

func (w *gzipWriter) Write(b []byte) (int, error) {
	if !w.started {
		if w.Header().Get("Content-Type") == "" {
			w.Header().Set("Content-Type", http.DetectContentType(b))
		}
		w.start(b)
	}
	if w.gz != nil {
		return w.gz.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

func (w *gzipWriter) Flush() {
	if !w.started {
		w.start(nil)
	}
	if w.gz != nil {
		w.gz.Flush()
	}
	http.NewResponseController(w.ResponseWriter).Flush()
}

func (w *gzipWriter) finish() {
	if !w.started {
		w.start(nil)
	}
	if w.gz != nil {
		w.gz.Close()
		w.gz.Reset(nil)
		gzipPool.Put(w.gz)
	}
}

func (w *gzipWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// compress gzips the JSON and the web app. WebSockets (agents, noVNC) never reach the wrapper.
func compress(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Accept-Encoding")
		if r.Header.Get("Upgrade") != "" || r.Method == http.MethodHead || !acceptsGzip(r) {
			next.ServeHTTP(w, r)
			return
		}
		gw := &gzipWriter{ResponseWriter: w}
		defer gw.finish()
		next.ServeHTTP(gw, r)
	})
}

// cacheGen changes with the state of the server: an event other than "metrics", or any write
// through the API. A cached read never outlives it, so a client reloading after its own write
// or after an event gets fresh data; "metrics" alone only ages the cache by its ttl.
var cacheGen atomic.Uint64

type capturedResponse struct {
	header http.Header
	code   int
	body   bytes.Buffer
}

func (c *capturedResponse) Header() http.Header         { return c.header }
func (c *capturedResponse) WriteHeader(code int)        { c.code = code }
func (c *capturedResponse) Write(b []byte) (int, error) { return c.body.Write(b) }

// cacheJSON shares the answer of a heavy read between clients for ttl at most. Concurrent
// readers wait for one build, and the answer is gzipped once. The route must answer the same
// to everyone allowed to call it. Requests with a query string are not cached, so their
// variety cannot grow the cache.
func cacheJSON(ttl time.Duration, h http.HandlerFunc) http.HandlerFunc {
	var c struct {
		sync.Mutex
		gen      uint64
		until    time.Time
		raw, gzd []byte
	}
	load := func(r *http.Request) (raw, gzd []byte, miss *capturedResponse) {
		c.Lock()
		defer c.Unlock()
		gen := cacheGen.Load()
		if gen == c.gen && time.Now().Before(c.until) {
			return c.raw, c.gzd, nil
		}
		rec := &capturedResponse{header: http.Header{}}
		// A reader leaving the page must not cache a failure for the others.
		h(rec, r.WithContext(context.WithoutCancel(r.Context())))
		if rec.code != 0 && rec.code != http.StatusOK {
			return nil, nil, rec
		}
		var out bytes.Buffer
		gz := gzipPool.Get().(*gzip.Writer)
		gz.Reset(&out)
		gz.Write(rec.body.Bytes())
		gz.Close()
		gz.Reset(nil)
		gzipPool.Put(gz)
		c.gen, c.until, c.raw, c.gzd = gen, time.Now().Add(ttl), rec.body.Bytes(), out.Bytes()
		return c.raw, c.gzd, nil
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			h(w, r)
			return
		}
		raw, gzd, miss := load(r)
		if miss != nil {
			for k, v := range miss.header {
				w.Header()[k] = v
			}
			w.WriteHeader(miss.code)
			w.Write(miss.body.Bytes())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if acceptsGzip(r) {
			w.Header().Set("Content-Encoding", "gzip")
			w.Write(gzd)
			return
		}
		w.Write(raw)
	}
}
