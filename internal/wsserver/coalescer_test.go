package wsserver

import (
	"sync"
	"testing"
	"time"
)

func TestCoalescer_ImmediateFlush(t *testing.T) {
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

	// Both writes should flush promptly
	time.Sleep(20 * time.Millisecond)

	mu.Lock()
	got := string(received)
	mu.Unlock()

	if got != "hello world" {
		t.Errorf("expected %q, got %q", "hello world", got)
	}
}

func TestCoalescer_LargeWrite(t *testing.T) {
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

	data := make([]byte, 16*1024)
	for i := range data {
		data[i] = 'x'
	}
	c.Write(data)

	time.Sleep(20 * time.Millisecond)

	mu.Lock()
	if flushCount != 1 {
		t.Errorf("expected 1 flush, got %d", flushCount)
	}
	if totalBytes != len(data) {
		t.Errorf("expected %d bytes, got %d", len(data), totalBytes)
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
