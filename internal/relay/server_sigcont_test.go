package relay

import (
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestServerAutoResumeOnSIGTSTP verifies that when a child process stops
// itself with SIGTSTP, the relay sends SIGCONT so the process resumes and
// runs to completion. Without auto-resume the child would be stuck in the
// stopped state forever and the second sentinel would never appear.
func TestServerAutoResumeOnSIGTSTP(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "test.sock")

	// Print "before-stop", stop ourselves, then print "after-cont".
	// `kill -STOP $$` sends SIGSTOP (not SIGTSTP), which is stronger:
	// SIGSTOP can't be caught or ignored, so if the relay is still
	// calling plain cmd.Wait() this test will hang until the deadline.
	// Once the fix lands, Wait4 with WUNTRACED sees the stop and the
	// relay sends SIGCONT to resume the child.
	script := `printf before-stop; kill -STOP $$; printf after-cont`

	srv, err := NewServer(sockPath, "/tmp", "sh", []string{"-c", script}, 4096, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	time.Sleep(100 * time.Millisecond)

	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	var output strings.Builder
	deadline := time.After(5 * time.Second)
	for {
		conn.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
		typ, payload, err := ReadFrame(conn)
		if err != nil {
			select {
			case <-deadline:
				t.Fatalf("timed out waiting for after-cont; output so far: %q", output.String())
			default:
				continue
			}
		}
		if typ == FrameData {
			output.Write(payload)
		}
		if strings.Contains(output.String(), "after-cont") {
			break
		}
	}

	got := output.String()
	if !strings.Contains(got, "before-stop") {
		t.Errorf("missing before-stop sentinel; output = %q", got)
	}
	if !strings.Contains(got, "after-cont") {
		t.Errorf("missing after-cont sentinel (child was not resumed); output = %q", got)
	}
}
