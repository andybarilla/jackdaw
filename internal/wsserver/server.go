package wsserver

import (
	"encoding/binary"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

const (
	msgTypeInput  = 0x01
	msgTypeResize = 0x02
)

// SessionWriter handles writing input and resize to a session.
type SessionWriter interface {
	WriteToSession(id string, data []byte) error
	ResizeSession(id string, cols, rows uint16) error
}

// Server is a WebSocket server for terminal I/O.
type Server struct {
	listener net.Listener
	server   *http.Server

	mu    sync.RWMutex
	conns map[string][]*wsConn // sessionID -> connections
}

type wsConn struct {
	conn      *websocket.Conn
	coalescer *Coalescer
	mu        sync.Mutex // protects conn writes
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Only accept connections from localhost (wails app)
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		return host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "wails.localhost"
	},
}

func New(writer SessionWriter) (*Server, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	s := &Server{
		listener: listener,
		conns:    make(map[string][]*wsConn),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/ws/", func(w http.ResponseWriter, r *http.Request) {
		s.handleWS(w, r, writer)
	})

	s.server = &http.Server{Handler: mux}

	go s.server.Serve(listener) //nolint:errcheck

	return s, nil
}

func (s *Server) Port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

func (s *Server) Close() {
	s.mu.Lock()
	for _, conns := range s.conns {
		for _, wc := range conns {
			wc.coalescer.Stop()
			wc.conn.Close()
		}
	}
	s.conns = make(map[string][]*wsConn)
	s.mu.Unlock()

	s.server.Close()
}

// SendOutput sends terminal output to all WebSocket connections for a session.
func (s *Server) SendOutput(sessionID string, data []byte) {
	s.mu.RLock()
	conns := s.conns[sessionID]
	s.mu.RUnlock()

	for _, wc := range conns {
		wc.coalescer.Write(data)
	}
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request, writer SessionWriter) {
	// Extract session ID from /ws/<sessionId>
	path := strings.TrimPrefix(r.URL.Path, "/ws/")
	sessionID := strings.TrimSuffix(path, "/")
	if sessionID == "" {
		http.Error(w, "missing session ID", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	wc := &wsConn{conn: conn}
	wc.coalescer = NewCoalescer(func(data []byte) {
		wc.mu.Lock()
		defer wc.mu.Unlock()
		wc.conn.WriteMessage(websocket.BinaryMessage, data) //nolint:errcheck
	})

	s.mu.Lock()
	s.conns[sessionID] = append(s.conns[sessionID], wc)
	s.mu.Unlock()

	defer func() {
		wc.coalescer.Stop()
		conn.Close()
		s.removeConn(sessionID, wc)
	}()

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if len(msg) < 1 {
			continue
		}

		switch msg[0] {
		case msgTypeInput:
			writer.WriteToSession(sessionID, msg[1:]) //nolint:errcheck
		case msgTypeResize:
			if len(msg) < 5 {
				continue
			}
			cols := binary.BigEndian.Uint16(msg[1:3])
			rows := binary.BigEndian.Uint16(msg[3:5])
			writer.ResizeSession(sessionID, cols, rows) //nolint:errcheck
		}
	}
}

func (s *Server) removeConn(sessionID string, wc *wsConn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	conns := s.conns[sessionID]
	for i, c := range conns {
		if c == wc {
			s.conns[sessionID] = append(conns[:i], conns[i+1:]...)
			break
		}
	}
	if len(s.conns[sessionID]) == 0 {
		delete(s.conns, sessionID)
	}
}
