package session

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/andybarilla/jackdaw/internal/ansi"
)

func newTestTracker(onChange func(Status)) *StatusTracker {
	st := NewStatusTracker(onChange)
	st.idleDelay = 10 * time.Millisecond
	return st
}

func TestInitialStatusIsWorking(t *testing.T) {
	st := newTestTracker(nil)
	if st.Status() != StatusWorking {
		t.Errorf("initial status = %q, want %q", st.Status(), StatusWorking)
	}
}

func TestHandleOutputPromptTriggersIdle(t *testing.T) {
	var mu sync.Mutex
	var got Status
	st := newTestTracker(func(s Status) {
		mu.Lock()
		got = s
		mu.Unlock()
	})

	// Send output containing the prompt character ❯
	st.HandleOutput([]byte("❯ "))
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if got != StatusIdle {
		t.Errorf("status after prompt = %q, want %q", got, StatusIdle)
	}
	if st.Status() != StatusIdle {
		t.Errorf("Status() = %q, want %q", st.Status(), StatusIdle)
	}
}

func TestHandleOutputNonPromptDoesNotTriggerIdle(t *testing.T) {
	called := false
	st := newTestTracker(func(s Status) {
		called = true
	})

	st.HandleOutput([]byte("some regular output\n"))
	time.Sleep(50 * time.Millisecond)

	if called {
		t.Error("onChange should not fire for non-prompt output")
	}
	if st.Status() != StatusWorking {
		t.Errorf("status = %q, want %q", st.Status(), StatusWorking)
	}
}

func TestHandleInputFromIdleTransitionsToWorking(t *testing.T) {
	var mu sync.Mutex
	var transitions []Status
	st := newTestTracker(func(s Status) {
		mu.Lock()
		transitions = append(transitions, s)
		mu.Unlock()
	})

	st.HandleOutput([]byte("❯ "))
	time.Sleep(50 * time.Millisecond)

	st.HandleInput()

	mu.Lock()
	defer mu.Unlock()
	if len(transitions) != 2 || transitions[0] != StatusIdle || transitions[1] != StatusWorking {
		t.Errorf("transitions = %v, want [idle working]", transitions)
	}
}

func TestHandleInputFromWaitingTransitionsToWorking(t *testing.T) {
	var mu sync.Mutex
	var transitions []Status
	st := newTestTracker(func(s Status) {
		mu.Lock()
		transitions = append(transitions, s)
		mu.Unlock()
	})

	st.HandlePermissionPrompt()
	st.HandleInput()

	mu.Lock()
	defer mu.Unlock()
	if len(transitions) != 2 || transitions[0] != StatusWaitingForApproval || transitions[1] != StatusWorking {
		t.Errorf("transitions = %v, want [waiting_for_approval working]", transitions)
	}
}

func TestHandlePermissionPrompt(t *testing.T) {
	var got Status
	st := newTestTracker(func(s Status) {
		got = s
	})

	st.HandlePermissionPrompt()
	if got != StatusWaitingForApproval {
		t.Errorf("status = %q, want %q", got, StatusWaitingForApproval)
	}
}

func TestHandleError(t *testing.T) {
	var got Status
	st := newTestTracker(func(s Status) {
		got = s
	})

	st.HandleError()
	if got != StatusError {
		t.Errorf("status = %q, want %q", got, StatusError)
	}
}

func TestErrorClearsOnPrompt(t *testing.T) {
	var mu sync.Mutex
	var transitions []Status
	st := newTestTracker(func(s Status) {
		mu.Lock()
		transitions = append(transitions, s)
		mu.Unlock()
	})

	st.HandleError()
	st.HandleOutput([]byte("❯ "))
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if len(transitions) < 2 || transitions[len(transitions)-1] != StatusIdle {
		t.Errorf("transitions = %v, want error then idle", transitions)
	}
}

func TestExitIsTerminal(t *testing.T) {
	callCount := 0
	st := newTestTracker(func(s Status) {
		callCount++
	})

	st.HandleExit(0)
	if st.Status() != StatusExited {
		t.Errorf("status = %q, want %q", st.Status(), StatusExited)
	}

	before := callCount
	st.HandleInput()
	st.HandleError()
	st.HandlePermissionPrompt()
	st.HandleOutput([]byte("❯ "))
	time.Sleep(50 * time.Millisecond)

	if callCount != before {
		t.Errorf("onChange fired %d times after exit, want 0", callCount-before)
	}
	if st.Status() != StatusExited {
		t.Errorf("status after operations = %q, want %q", st.Status(), StatusExited)
	}
}

func TestStopIsTerminal(t *testing.T) {
	callCount := 0
	st := newTestTracker(func(s Status) {
		callCount++
	})

	st.HandleStop()
	if st.Status() != StatusStopped {
		t.Errorf("status = %q, want %q", st.Status(), StatusStopped)
	}

	before := callCount
	st.HandleInput()
	st.HandleError()
	st.HandlePermissionPrompt()
	st.HandleOutput([]byte("❯ "))
	time.Sleep(50 * time.Millisecond)

	if callCount != before {
		t.Errorf("onChange fired %d times after stop, want 0", callCount-before)
	}
}

func TestDebounceResetsTimer(t *testing.T) {
	var mu sync.Mutex
	var got Status
	st := newTestTracker(func(s Status) {
		mu.Lock()
		got = s
		mu.Unlock()
	})

	// Send prompt, then quickly send non-prompt output before debounce fires
	st.HandleOutput([]byte("❯ "))
	time.Sleep(3 * time.Millisecond) // less than 10ms debounce
	st.HandleOutput([]byte("more output\n"))
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if got == StatusIdle {
		t.Error("idle should not fire when non-prompt output cancels the debounce")
	}
}

func TestOnChangeDoesNotFireWhenStatusUnchanged(t *testing.T) {
	callCount := 0
	st := newTestTracker(func(s Status) {
		callCount++
	})

	// HandleInput from working -> working should not fire
	st.HandleInput()
	if callCount != 0 {
		t.Errorf("onChange fired %d times for no-op transition, want 0", callCount)
	}

	// Double permission prompt should fire once
	st.HandlePermissionPrompt()
	st.HandlePermissionPrompt()
	if callCount != 1 {
		t.Errorf("onChange fired %d times for duplicate permission prompt, want 1", callCount)
	}
}

func TestLastLineBasic(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("first line\nsecond line\nthird line\n"))
	if st.LastLine() != "third line" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "third line")
	}
}

func TestLastLineSkipsPrompt(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("real output\n❯ \n"))
	if st.LastLine() != "real output" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "real output")
	}
}

func TestLastLineWithANSI(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("\x1b[32mcolored output\x1b[0m\n"))
	if st.LastLine() != "colored output" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "colored output")
	}
}

func TestLastLineRemovesOSCSequence(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("\x1b]0;title\x07build completed\n"))
	if st.LastLine() != "build completed" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "build completed")
	}
}

func TestLastLineHandlesSplitCSISequenceAcrossChunks(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("\x1b[32"))
	st.HandleOutput([]byte("mcolored output\x1b[0m\n"))
	if st.LastLine() != "colored output" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "colored output")
	}
}

func TestPromptDetectionHandlesSplitCSIWrappedPromptAcrossChunks(t *testing.T) {
	var mu sync.Mutex
	var got Status
	st := newTestTracker(func(s Status) {
		mu.Lock()
		got = s
		mu.Unlock()
	})

	st.HandleOutput([]byte("\x1b[32"))
	st.HandleOutput([]byte("m❯\x1b[0m "))
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if got != StatusIdle {
		t.Errorf("status = %q, want %q", got, StatusIdle)
	}
	if st.Status() != StatusIdle {
		t.Errorf("Status() = %q, want %q", st.Status(), StatusIdle)
	}
}

func TestLastLineHandlesSplitOSCBELSequenceAcrossChunks(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("\x1b]0;tit"))
	st.HandleOutput([]byte("le\x07ready\n"))
	if st.LastLine() != "ready" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "ready")
	}
}

func TestLastLineHandlesSplitOSCSTSequenceAcrossChunks(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("\x1b]0;title\x1b"))
	st.HandleOutput([]byte("\\ready\n"))
	if st.LastLine() != "ready" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "ready")
	}
}

func TestCarryoverOverflowFallsBackToStatelessStripping(t *testing.T) {
	st := newTestTracker(nil)
	overflowing := []byte("\x1b]0;" + strings.Repeat("a", 300) + " visible output\n")

	st.HandleOutput(overflowing)
	expected := strings.TrimRight(string(ansi.StripBytes(overflowing)), "\r \n")
	if len(expected) > 200 {
		expected = expected[:200]
	}
	if st.LastLine() != expected {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), expected)
	}

	st.HandleOutput([]byte("safe output\n"))
	if st.LastLine() != "safe output" {
		t.Errorf("LastLine() = %q, want %q", st.LastLine(), "safe output")
	}
}

func TestLastLineTruncationStillCapsAt200AfterStrip(t *testing.T) {
	st := newTestTracker(nil)
	visible := strings.Repeat("a", 210)
	st.HandleOutput([]byte("\x1b[32m" + visible + "\x1b[0m\n"))
	if len(st.LastLine()) != 200 {
		t.Errorf("LastLine() length = %d, want 200", len(st.LastLine()))
	}
}

func TestLastLineTruncation(t *testing.T) {
	st := newTestTracker(nil)
	long := make([]byte, 300)
	for i := range long {
		long[i] = 'a'
	}
	st.HandleOutput(append(long, '\n'))
	if len(st.LastLine()) != 200 {
		t.Errorf("LastLine() length = %d, want 200", len(st.LastLine()))
	}
}

func TestLastLineEmptyOutput(t *testing.T) {
	st := newTestTracker(nil)
	st.HandleOutput([]byte("   \n\n  \n"))
	if st.LastLine() != "" {
		t.Errorf("LastLine() = %q, want empty string", st.LastLine())
	}
}

func TestHandleOutputWithANSIStillTriggersIdle(t *testing.T) {
	var mu sync.Mutex
	var got Status
	st := newTestTracker(func(s Status) {
		mu.Lock()
		got = s
		mu.Unlock()
	})

	// Prompt wrapped in ANSI escape codes
	st.HandleOutput([]byte("\x1b[32m❯\x1b[0m "))
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if got != StatusIdle {
		t.Errorf("status = %q, want %q (ANSI should be stripped)", got, StatusIdle)
	}
}
