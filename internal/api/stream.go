package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
)

func init() {
	handlers["session.read"] = handleSessionRead
}

func handleSessionRead(s *Server, params json.RawMessage, conn net.Conn) (interface{}, error) {
	id, err := requireString(params, "id")
	if err != nil {
		return nil, err
	}

	info := s.manager.GetSessionInfo(id)
	if info == nil {
		return nil, errNotFound(fmt.Sprintf("session %q not found", id))
	}

	// Replay history
	history, err := s.manager.GetSessionHistory(id)
	if err != nil {
		return nil, errInternal("failed to read history: " + err.Error())
	}
	if len(history) > 0 {
		s.writeResponse(conn, Response{
			OK: true,
			Data: map[string]interface{}{
				"output": base64.StdEncoding.EncodeToString(history),
			},
		})
	}

	// Subscribe to live output
	ch, unsub, err := s.manager.SubscribeOutput(id)
	if err != nil {
		// Session may have exited between GetSessionInfo and SubscribeOutput
		s.writeResponse(conn, Response{
			OK:   true,
			Data: map[string]interface{}{"eof": true},
		})
		return nil, nil
	}
	defer unsub()

	// Stream until session exits, server stops, or client disconnects.
	// We detect client disconnect by watching for context cancellation
	// (server shutdown) or channel close (session exit cleanup).
	for {
		select {
		case data, ok := <-ch:
			if !ok {
				// Channel closed — session ended
				s.writeResponse(conn, Response{
					OK:   true,
					Data: map[string]interface{}{"eof": true},
				})
				return nil, nil
			}
			s.writeResponse(conn, Response{
				OK: true,
				Data: map[string]interface{}{
					"output": base64.StdEncoding.EncodeToString(data),
				},
			})
		case <-s.ctx.Done():
			return nil, nil
		}
	}
}
