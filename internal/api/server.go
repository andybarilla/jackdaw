package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"sync"

	"github.com/andybarilla/jackdaw/internal/session"
)

// Request is a single NDJSON request from a client.
type Request struct {
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

// Response is a single NDJSON response to a client.
type Response struct {
	OK    bool         `json:"ok"`
	Data  interface{}  `json:"data,omitempty"`
	Error *ErrorDetail `json:"error,omitempty"`
}

// ErrorDetail carries a machine-readable code and human-readable message.
type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Server listens on a Unix socket and dispatches NDJSON requests to handlers.
type Server struct {
	manager  *session.Manager
	sockPath string
	listener net.Listener

	// CreateFunc, when set, is called by session.create instead of calling
	// the manager directly. This lets the Wails app inject its full creation
	// logic (hooks, notifications, WebSocket output).
	CreateFunc func(workDir, command string, args []string, name, workspaceID string) (*session.SessionInfo, error)

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// New creates a new API server. Call Start to begin accepting connections.
func New(manager *session.Manager, sockPath string) *Server {
	ctx, cancel := context.WithCancel(context.Background())
	return &Server{
		manager:  manager,
		sockPath: sockPath,
		ctx:      ctx,
		cancel:   cancel,
	}
}

// Start removes any stale socket file, begins listening, and spawns the accept loop.
func (s *Server) Start() error {
	// Remove stale socket from a previous crash
	os.Remove(s.sockPath)

	ln, err := net.Listen("unix", s.sockPath)
	if err != nil {
		return fmt.Errorf("api listen: %w", err)
	}
	s.listener = ln

	// Make socket accessible only to the current user
	os.Chmod(s.sockPath, 0600)

	s.wg.Add(1)
	go s.acceptLoop()
	return nil
}

// Stop closes the listener, cancels active connections, and removes the socket file.
func (s *Server) Stop() error {
	s.cancel()
	var err error
	if s.listener != nil {
		err = s.listener.Close()
	}
	s.wg.Wait()
	os.Remove(s.sockPath)
	return err
}

func (s *Server) acceptLoop() {
	defer s.wg.Done()
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			// Listener closed — normal shutdown path
			return
		}
		s.wg.Add(1)
		go s.handleConn(conn)
	}
}

func (s *Server) handleConn(conn net.Conn) {
	defer s.wg.Done()
	defer conn.Close()

	// Close connection when server context is cancelled
	go func() {
		<-s.ctx.Done()
		conn.Close()
	}()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024) // 1MB max line

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			s.writeResponse(conn, Response{
				OK: false,
				Error: &ErrorDetail{
					Code:    "invalid_request",
					Message: "malformed JSON: " + err.Error(),
				},
			})
			continue
		}

		if req.Method == "" {
			s.writeResponse(conn, Response{
				OK: false,
				Error: &ErrorDetail{
					Code:    "invalid_request",
					Message: "missing method",
				},
			})
			continue
		}

		s.dispatch(conn, &req)
	}
}

func (s *Server) dispatch(conn net.Conn, req *Request) {
	handler, ok := handlers[req.Method]
	if !ok {
		s.writeResponse(conn, Response{
			OK: false,
			Error: &ErrorDetail{
				Code:    "invalid_request",
				Message: fmt.Sprintf("unknown method %q", req.Method),
			},
		})
		return
	}

	data, err := handler(s, req.Params, conn)
	if err != nil {
		s.writeResponse(conn, Response{
			OK:    false,
			Error: mapError(err),
		})
		return
	}

	// Streaming handlers write their own responses (data == nil)
	if data != nil {
		s.writeResponse(conn, Response{OK: true, Data: data})
	}
}

func (s *Server) writeResponse(conn net.Conn, resp Response) {
	data, err := json.Marshal(resp)
	if err != nil {
		log.Printf("api: marshal response: %v", err)
		return
	}
	data = append(data, '\n')
	conn.Write(data)
}

// WriteResponse writes a single NDJSON response line to conn. Exported for
// streaming handlers that need to send multiple responses.
func (s *Server) WriteResponse(conn net.Conn, resp Response) {
	s.writeResponse(conn, resp)
}
