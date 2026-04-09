package wsserver

import (
	"sync"
	"testing"
	"time"
)

func TestCoalescer_FlushOnIdle(t *testing.T) {
	var mu sync.Mutex
	var received []byte

	c := NewCoalescer(func(data []byte) {
		mu.Lock()
		received = append(received, data...)
		mu.Unlock()
	})
	defer c.Stop()

	c.Write([]byte("hello"))
	c.Write([]byte(" world"))

	// Wait for idle flush
	time.Sleep(20 * time.Millisecond)

	mu.Lock()
	got := string(received)
	mu.Unlock()

	if got != "hello world" {
		t.Errorf("expected %q, got %q", "hello world", got)
	}
}

func TestCoalescer_FlushOnMaxBuffer(t *testing.T) {
	var mu sync.Mutex
	var flushCount int
	var totalBytes int

	c := NewCoalescer(func(data []byte) {
		mu.Lock()
		flushCount++
		totalBytes += len(data)
		mu.Unlock()
	})
	defer c.Stop()

	// Write exactly maxBufferSize bytes
	data := make([]byte, maxBufferSize)
	for i := range data {
		data[i] = 'x'
	}
	c.Write(data)

	// Should have flushed immediately
	mu.Lock()
	if flushCount != 1 {
		t.Errorf("expected 1 flush, got %d", flushCount)
	}
	if totalBytes != maxBufferSize {
		t.Errorf("expected %d bytes, got %d", maxBufferSize, totalBytes)
	}
	mu.Unlock()
}

func TestCoalescer_Stop(t *testing.T) {
	var mu sync.Mutex
	var received []byte

	c := NewCoalescer(func(data []byte) {
		mu.Lock()
		received = append(received, data...)
		mu.Unlock()
	})

	c.Write([]byte("pending"))
	c.Stop()

	mu.Lock()
	got := string(received)
	mu.Unlock()

	if got != "pending" {
		t.Errorf("expected %q flushed on stop, got %q", "pending", got)
	}

	// Writes after stop should be ignored
	c.Write([]byte("after"))
	time.Sleep(10 * time.Millisecond)

	mu.Lock()
	got = string(received)
	mu.Unlock()

	if got != "pending" {
		t.Errorf("expected no change after stop, got %q", got)
	}
}
