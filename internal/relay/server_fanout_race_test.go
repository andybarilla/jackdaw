package relay

import (
	"bytes"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// TestFanoutRaceNoDuplicates is a forward-looking property test for the
// relay fanout race fix (commit a6bf0be). It asserts that across many
// concurrent client connects against a busy producer, every client's
// received stream is a contiguous suffix of the canonical produced stream
// with no duplicated frames and no gaps. Runs with -race to also catch the
// historyWriter race.
//
// Note: this test does NOT deterministically reproduce the original bug.
// The race window between buffer.Write and the fanout critical section in
// the pre-fix readPTY was only a few instructions wide — too narrow for a
// time-based connect stagger to hit reliably. Its role is to guard against
// future refactors that re-introduce the race: with 100 clients per
// iteration and 5 internal iterations (500 concurrent connects per run),
// any regression that meaningfully widens the window will be caught.
func TestFanoutRaceNoDuplicates(t *testing.T) {
	const iterations = 5
	for iter := 0; iter < iterations; iter++ {
		iter := iter
		t.Run(fmt.Sprintf("iter-%d", iter), func(t *testing.T) {
			runFanoutRaceIteration(t)
		})
	}
}

func runFanoutRaceIteration(t *testing.T) {
	sockPath := filepath.Join(t.TempDir(), "race.sock")

	// Emit a long, easily-checkable sequence: 2000 lines of "LINE-<n>\n".
	// Each line is unique so duplication is unambiguous. Space the writes
	// out so connects actually race with production — otherwise the shell
	// finishes in a single pty read burst and snapshots just serve the
	// whole buffer with no fanout overlap.
	script := `for i in $(seq 1 2000); do printf 'LINE-%04d\n' "$i"; sleep 0.002; done`

	srv, err := NewServer(sockPath, "/tmp", "sh", []string{"-c", script}, 65536, "", 0)
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	defer srv.Close()

	go srv.Serve()
	// Give the listener a beat to come up but start connecting before the
	// child is anywhere near done so we race buffer writes against snapshots.
	time.Sleep(20 * time.Millisecond)

	const numClients = 100
	var wg sync.WaitGroup
	errCh := make(chan error, numClients)

	for i := 0; i < numClients; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			// Tight stagger (~1s total) keeps every connect landing inside
			// the ~4s production window so snapshots race fanout frames.
			time.Sleep(time.Duration(idx) * 10 * time.Millisecond)

			c, err := NewClient(sockPath)
			if err != nil {
				errCh <- fmt.Errorf("client %d dial: %w", idx, err)
				return
			}
			defer c.Close()

			var mu sync.Mutex
			var buf bytes.Buffer
			done := make(chan struct{})

			c.OnOutput = func(data []byte) {
				mu.Lock()
				buf.Write(data)
				mu.Unlock()
			}
			c.OnReplayEnd = func() {
				// Replay marker; keep reading live frames.
			}
			c.StartReadLoop()

			// Read until we observe the final line or time out.
			go func() {
				deadline := time.Now().Add(10 * time.Second)
				for time.Now().Before(deadline) {
					mu.Lock()
					hasEnd := bytes.Contains(buf.Bytes(), []byte("LINE-2000\n"))
					mu.Unlock()
					if hasEnd {
						close(done)
						return
					}
					time.Sleep(20 * time.Millisecond)
				}
				close(done)
			}()
			<-done

			mu.Lock()
			got := append([]byte(nil), buf.Bytes()...)
			mu.Unlock()

			if err := assertContiguousSuffix(got); err != nil {
				errCh <- fmt.Errorf("client %d: %w", idx, err)
			}
		}(i)
	}

	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Error(err)
	}
}

// assertContiguousSuffix verifies that got contains LINE-XXXX\n entries that
// form a contiguous, strictly-increasing sequence with no duplicates and no
// gaps. Leading/trailing partial-line bytes are tolerated because frame
// boundaries don't align to lines.
func assertContiguousSuffix(got []byte) error {
	// Trim to first complete line.
	first := bytes.IndexByte(got, '\n')
	if first < 0 {
		return fmt.Errorf("no complete lines received (%d bytes)", len(got))
	}
	body := got[first+1:]

	// Trim trailing partial line.
	last := bytes.LastIndexByte(body, '\n')
	if last < 0 {
		return fmt.Errorf("only one line received")
	}
	body = body[:last+1]

	lines := bytes.Split(bytes.TrimRight(body, "\n"), []byte{'\n'})
	if len(lines) == 0 {
		return fmt.Errorf("no lines after trimming")
	}

	var prev int
	for i, ln := range lines {
		var n int
		if _, err := fmt.Sscanf(string(ln), "LINE-%d", &n); err != nil {
			return fmt.Errorf("line %d: unparseable %q", i, ln)
		}
		if i == 0 {
			prev = n
			continue
		}
		if n != prev+1 {
			return fmt.Errorf("non-contiguous at index %d: got LINE-%04d after LINE-%04d", i, n, prev)
		}
		prev = n
	}
	return nil
}
