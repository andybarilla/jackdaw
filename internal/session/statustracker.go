package session

import (
	"bytes"
	"regexp"
	"sync"
	"sync/atomic"
	"time"

	"github.com/andybarilla/jackdaw/internal/ansi"
)

const (
	maxANSICarryover = 256
)

// promptPattern matches Claude Code's idle prompt character (U+276F) at a line start,
// optionally preceded by whitespace.
var promptPattern = regexp.MustCompile(`(?m)^\s*❯`)

type StatusTracker struct {
	mu        sync.Mutex
	status    Status
	lastLine  atomic.Value // string; lock-free reads avoid deadlock with DashboardData
	onChange  func(Status)
	idleTimer *time.Timer
	idleDelay time.Duration
	carryover []byte
}

func NewStatusTracker(onChange func(Status)) *StatusTracker {
	return &StatusTracker{
		status:    StatusWorking,
		onChange:  onChange,
		idleDelay: 500 * time.Millisecond,
	}
}

func (st *StatusTracker) Status() Status {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.status
}

func (st *StatusTracker) LastLine() string {
	v, _ := st.lastLine.Load().(string)
	return v
}

func (st *StatusTracker) HandleOutput(data []byte) {
	st.mu.Lock()
	defer st.mu.Unlock()

	combined := make([]byte, 0, len(st.carryover)+len(data))
	combined = append(combined, st.carryover...)
	combined = append(combined, data...)

	complete, carryover := splitTrailingANSICarryover(combined)
	st.carryover = append([]byte(nil), carryover...)
	if len(complete) == 0 {
		return
	}

	cleaned := ansi.StripBytes(complete)

	// Extract last non-empty, non-prompt line for dashboard display.
	lines := bytes.Split(cleaned, []byte("\n"))
	for i := len(lines) - 1; i >= 0; i-- {
		line := bytes.TrimRight(lines[i], "\r ")
		if len(line) == 0 {
			continue
		}
		if promptPattern.Match(line) {
			continue
		}
		s := string(line)
		if len(s) > 200 {
			s = s[:200]
		}
		st.lastLine.Store(s)
		break
	}

	if st.isTerminal() {
		return
	}

	// Check for prompt pattern
	if promptPattern.Match(bytes.TrimRight(cleaned, "\n\r ")) {
		// Reset debounce timer
		if st.idleTimer != nil {
			st.idleTimer.Stop()
		}
		st.idleTimer = time.AfterFunc(st.idleDelay, func() {
			st.mu.Lock()
			defer st.mu.Unlock()
			if !st.isTerminal() {
				st.setStatusLocked(StatusIdle)
			}
		})
	} else {
		// Non-prompt output: cancel any pending idle transition
		if st.idleTimer != nil {
			st.idleTimer.Stop()
			st.idleTimer = nil
		}
	}
}

func (st *StatusTracker) HandleInput() {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.status == StatusIdle || st.status == StatusWaitingForApproval {
		st.setStatusLocked(StatusWorking)
	}
}

func (st *StatusTracker) HandlePermissionPrompt() {
	st.mu.Lock()
	defer st.mu.Unlock()
	if !st.isTerminal() {
		st.setStatusLocked(StatusWaitingForApproval)
	}
}

func (st *StatusTracker) HandleError() {
	st.mu.Lock()
	defer st.mu.Unlock()
	if !st.isTerminal() {
		st.setStatusLocked(StatusError)
	}
}

func (st *StatusTracker) HandleExit(exitCode int) {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.idleTimer != nil {
		st.idleTimer.Stop()
		st.idleTimer = nil
	}
	st.setStatusLocked(StatusExited)
}

func (st *StatusTracker) HandleStop() {
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.idleTimer != nil {
		st.idleTimer.Stop()
		st.idleTimer = nil
	}
	st.setStatusLocked(StatusStopped)
}

func (st *StatusTracker) isTerminal() bool {
	return st.status == StatusStopped || st.status == StatusExited
}

func (st *StatusTracker) setStatusLocked(s Status) {
	if s == st.status {
		return
	}
	if st.isTerminal() {
		return
	}
	st.status = s
	if st.onChange != nil {
		st.onChange(s)
	}
}

func splitTrailingANSICarryover(data []byte) (complete []byte, carryover []byte) {
	csiStart := trailingPartialCSIStart(data)
	oscStart := trailingPartialOSCStart(data)

	start := -1
	switch {
	case csiStart >= 0 && oscStart >= 0:
		if csiStart < oscStart {
			start = csiStart
		} else {
			start = oscStart
		}
	case csiStart >= 0:
		start = csiStart
	case oscStart >= 0:
		start = oscStart
	default:
		return data, nil
	}

	candidate := data[start:]
	if len(candidate) > maxANSICarryover {
		return data, nil
	}

	return data[:start], candidate
}

func trailingPartialCSIStart(data []byte) int {
	for i := len(data) - 2; i >= 0; i-- {
		if data[i] != 0x1b || data[i+1] != '[' {
			continue
		}
		for j := i + 2; j < len(data); j++ {
			if data[j] >= 0x40 && data[j] <= 0x7e {
				goto nextCandidate
			}
		}
		return i

	nextCandidate:
	}

	return -1
}

func trailingPartialOSCStart(data []byte) int {
	for i := len(data) - 2; i >= 0; i-- {
		if data[i] != 0x1b || data[i+1] != ']' {
			continue
		}
		if !hasCompleteOSCTerminator(data, i) {
			return i
		}
	}

	return -1
}

func hasCompleteOSCTerminator(data []byte, start int) bool {
	for i := start + 2; i < len(data); i++ {
		if data[i] == 0x07 {
			return true
		}
		if data[i] == 0x1b && i+1 < len(data) && data[i+1] == '\\' {
			return true
		}
	}

	return false
}
