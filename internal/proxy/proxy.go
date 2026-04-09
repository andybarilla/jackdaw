package proxy

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
)

// Server runs a local HTTP proxy that forwards requests to target URLs,
// stripping frame-busting headers so content can load in iframes.
type Server struct {
	listener net.Listener
	baseURL  string
}

// Start launches the proxy server on a random port and returns it.
func Start() (*Server, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("proxy listen: %w", err)
	}

	s := &Server{
		listener: ln,
		baseURL:  fmt.Sprintf("http://127.0.0.1:%d", ln.Addr().(*net.TCPAddr).Port),
	}

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Path format: /{target_url}
		// e.g. /http://localhost:3000/index.html
		targetURL := strings.TrimPrefix(r.URL.Path, "/")
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}

		if !strings.HasPrefix(targetURL, "http://") && !strings.HasPrefix(targetURL, "https://") {
			http.Error(w, "invalid target URL", http.StatusBadRequest)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}

		for _, h := range []string{"Accept", "Accept-Language", "Content-Type"} {
			if v := r.Header.Get(h); v != "" {
				req.Header.Set(h, v)
			}
		}

		resp, err := client.Do(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		// Copy response headers, stripping frame-busting ones
		for k, vs := range resp.Header {
			kl := strings.ToLower(k)
			if kl == "x-frame-options" || kl == "content-security-policy" {
				continue
			}
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}

		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	go http.Serve(ln, mux)

	return s, nil
}

// BaseURL returns the proxy's base URL (e.g. "http://127.0.0.1:43210").
func (s *Server) BaseURL() string {
	return s.baseURL
}

// Close stops the proxy server.
func (s *Server) Close() error {
	return s.listener.Close()
}
