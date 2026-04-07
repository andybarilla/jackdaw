package relay

import "sync"

type RingBuffer struct {
	buf  []byte
	size int
	pos  int
	full bool
	mu   sync.Mutex
}

func NewRingBuffer(size int) *RingBuffer {
	return &RingBuffer{
		buf:  make([]byte, size),
		size: size,
	}
}

func (rb *RingBuffer) Write(data []byte) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	if len(data) >= rb.size {
		copy(rb.buf, data[len(data)-rb.size:])
		rb.pos = 0
		rb.full = true
		return
	}

	n := len(data)
	firstPart := rb.size - rb.pos
	if firstPart >= n {
		copy(rb.buf[rb.pos:], data)
	} else {
		copy(rb.buf[rb.pos:], data[:firstPart])
		copy(rb.buf, data[firstPart:])
	}

	oldPos := rb.pos
	rb.pos = (rb.pos + n) % rb.size
	if !rb.full && (rb.pos <= oldPos && n > 0) {
		rb.full = true
	}
}

func (rb *RingBuffer) Size() int {
	return rb.size
}

func (rb *RingBuffer) Bytes() []byte {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	if !rb.full {
		return append([]byte(nil), rb.buf[:rb.pos]...)
	}
	result := make([]byte, rb.size)
	firstPart := rb.size - rb.pos
	copy(result, rb.buf[rb.pos:])
	copy(result[firstPart:], rb.buf[:rb.pos])
	return result
}
