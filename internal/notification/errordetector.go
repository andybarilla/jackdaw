package notification

import (
	"bytes"
	"regexp"
	"sync"
	"time"
)

var errorPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^error[\s:\[]`),
	regexp.MustCompile(`(?i)^fatal[\s:\[]`),
	regexp.MustCompile(`panic:`),
	regexp.MustCompile(`Traceback \(most recent call last\)`),
	regexp.MustCompile(`(?i)segmentation fault`),
	regexp.MustCompile(`(?i)out of memory`),
	regexp.MustCompile(`(?i)FAILED`),
	regexp.MustCompile(`npm ERR!`),
	regexp.MustCompile(`(?i)compilation failed`),
	regexp.MustCompile(`(?i)build failed`),
}

const maxMessageLen = 200

type ErrorDetector struct {
	svc              *Service
	sessionID        string
	sessionName      string
	DebounceInterval time.Duration

	lastFired time.Time
	mu        sync.Mutex
}

func NewErrorDetector(svc *Service, sessionID string, sessionName string) *ErrorDetector {
	return &ErrorDetector{
		svc:              svc,
		sessionID:        sessionID,
		sessionName:      sessionName,
		DebounceInterval: 30 * time.Second,
	}
}

func (ed *ErrorDetector) Feed(data []byte) {
	cleaned := StripANSI(data)
	lines := bytes.Split(cleaned, []byte("\n"))
	for _, line := range lines {
		for _, pat := range errorPatterns {
			if pat.Match(line) {
				ed.fire(string(line))
				return
			}
		}
	}
}

func (ed *ErrorDetector) fire(matchedLine string) {
	ed.mu.Lock()
	defer ed.mu.Unlock()

	now := time.Now()
	if now.Sub(ed.lastFired) < ed.DebounceInterval {
		return
	}
	ed.lastFired = now

	msg := matchedLine
	if len(msg) > maxMessageLen {
		msg = msg[:maxMessageLen-3] + "..."
	}

	ed.svc.Notify(Notification{
		SessionID:   ed.sessionID,
		SessionName: ed.sessionName,
		Type:        TypeErrorDetected,
		Message:     msg,
	})
}
