package wsserver

import "sync"

const sendQueueSize = 64

// Coalescer sends output to a flush callback via a buffered channel,
// decoupling data production from the (potentially slow) flush I/O.
type Coalescer struct {
	mu      sync.Mutex
	outCh   chan []byte
	stopped bool
	done    chan struct{}
}

func NewCoalescer(flush func([]byte)) *Coalescer {
	c := &Coalescer{
		outCh: make(chan []byte, sendQueueSize),
		done:  make(chan struct{}),
	}
	go func() {
		defer close(c.done)
		for data := range c.outCh {
			flush(data)
		}
	}()
	return c
}

func (c *Coalescer) Write(data []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopped {
		return
	}
	out := make([]byte, len(data))
	copy(out, data)
	c.outCh <- out
}

func (c *Coalescer) Stop() {
	c.mu.Lock()
	c.stopped = true
	c.mu.Unlock()
	close(c.outCh)
	<-c.done
}
