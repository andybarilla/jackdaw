package wsserver

import (
	"sync"
	"time"
)

const (
	flushInterval = 2 * time.Millisecond
	maxBufferSize = 16 * 1024 // 16KB
)

// Coalescer buffers output and flushes on idle timeout or buffer size limit.
type Coalescer struct {
	mu      sync.Mutex
	buf     []byte
	flush   func([]byte)
	timer   *time.Timer
	stopped bool
}

func NewCoalescer(flush func([]byte)) *Coalescer {
	return &Coalescer{
		flush: flush,
	}
}

func (c *Coalescer) Write(data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.stopped {
		return
	}

	c.buf = append(c.buf, data...)

	if len(c.buf) >= maxBufferSize {
		c.doFlush()
		return
	}

	if c.timer != nil {
		c.timer.Stop()
	}
	c.timer = time.AfterFunc(flushInterval, func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.doFlush()
	})
}

// doFlush sends buffered data. Must be called with c.mu held.
func (c *Coalescer) doFlush() {
	if len(c.buf) == 0 {
		return
	}
	out := c.buf
	c.buf = nil
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	c.flush(out)
}

func (c *Coalescer) Stop() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stopped = true
	c.doFlush()
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
}
