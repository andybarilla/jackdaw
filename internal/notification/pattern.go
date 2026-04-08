package notification

import (
	"regexp"
	"sync"
	"time"
)

var inputPatterns = []*regexp.Regexp{
	regexp.MustCompile(`\[Y/n\]`),
	regexp.MustCompile(`\[y/N\]`),
	regexp.MustCompile(`(?i)press enter`),
	regexp.MustCompile(`(?i)continue\?`),
	regexp.MustCompile(`(?i)password:\s*$`),
	regexp.MustCompile(`(?i)passphrase:\s*$`),
	regexp.MustCompile(`(?i)\ballow\b.*\bdeny\b`),
	regexp.MustCompile(`(?i)\bapprove\b`),
}

type PatternMatcher struct {
	svc              *Service
	sessionID        string
	sessionName      string
	DebounceInterval time.Duration

	lastFired time.Time
	mu        sync.Mutex
}

func NewPatternMatcher(svc *Service, sessionID string, sessionName string) *PatternMatcher {
	return &PatternMatcher{
		svc:              svc,
		sessionID:        sessionID,
		sessionName:      sessionName,
		DebounceInterval: 10 * time.Second,
	}
}

func (pm *PatternMatcher) Feed(data []byte) {
	cleaned := StripANSI(data)
	for _, pat := range inputPatterns {
		if pat.Match(cleaned) {
			pm.fire(string(cleaned))
			return
		}
	}
}

func (pm *PatternMatcher) fire(context string) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	now := time.Now()
	if now.Sub(pm.lastFired) < pm.DebounceInterval {
		return
	}
	pm.lastFired = now

	pm.svc.Notify(Notification{
		SessionID:   pm.sessionID,
		SessionName: pm.sessionName,
		Type:        TypeInputRequired,
		Message:     "Session may be waiting for input",
	})
}
