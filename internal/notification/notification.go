package notification

import (
	"sync"
	"time"
)

type NotificationType string

const (
	TypeSessionExited NotificationType = "session_exited"
	TypeInputRequired NotificationType = "input_required"
)

type Notification struct {
	SessionID       string           `json:"sessionID"`
	SessionName     string           `json:"sessionName"`
	Type            NotificationType `json:"type"`
	Message         string           `json:"message"`
	Timestamp       time.Time        `json:"timestamp"`
	ApproveResponse string           `json:"approveResponse,omitempty"`
	DenyResponse    string           `json:"denyResponse,omitempty"`
}

type Service struct {
	Enabled        bool
	OnNotification func(Notification)

	active map[string]Notification
	mu     sync.RWMutex
}

func NewService() *Service {
	return &Service{
		Enabled: true,
		active:  make(map[string]Notification),
	}
}

func (s *Service) Notify(n Notification) {
	if !s.Enabled {
		return
	}
	if n.Timestamp.IsZero() {
		n.Timestamp = time.Now()
	}

	s.mu.Lock()
	s.active[n.SessionID] = n
	s.mu.Unlock()

	if s.OnNotification != nil {
		s.OnNotification(n)
	}
}

func (s *Service) Dismiss(sessionID string) {
	s.mu.Lock()
	delete(s.active, sessionID)
	s.mu.Unlock()
}

func (s *Service) HasActive(sessionID string) bool {
	s.mu.RLock()
	_, ok := s.active[sessionID]
	s.mu.RUnlock()
	return ok
}

func (s *Service) ActiveNotifications() map[string]Notification {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]Notification, len(s.active))
	for k, v := range s.active {
		result[k] = v
	}
	return result
}

func (s *Service) Close() {
	s.mu.Lock()
	s.active = make(map[string]Notification)
	s.mu.Unlock()
}
