package relay

import (
	"bytes"
	"testing"
)

func TestWriteAndReadFrame(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte("hello world")
	if err := WriteFrame(&buf, FrameData, payload); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	typ, got, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if typ != FrameData {
		t.Errorf("type = %d, want %d", typ, FrameData)
	}
	if !bytes.Equal(got, payload) {
		t.Errorf("payload = %q, want %q", got, payload)
	}
}

func TestWriteAndReadResizeFrame(t *testing.T) {
	var buf bytes.Buffer
	payload := EncodeResize(120, 40)
	if err := WriteFrame(&buf, FrameResize, payload); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	typ, data, err := ReadFrame(&buf)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	if typ != FrameResize {
		t.Errorf("type = %d, want %d", typ, FrameResize)
	}
	cols, rows := DecodeResize(data)
	if cols != 120 || rows != 40 {
		t.Errorf("resize = %dx%d, want 120x40", cols, rows)
	}
}

func TestReadFrameEmpty(t *testing.T) {
	var buf bytes.Buffer
	_, _, err := ReadFrame(&buf)
	if err == nil {
		t.Error("expected error reading from empty buffer")
	}
}

func TestMultipleFrames(t *testing.T) {
	var buf bytes.Buffer
	WriteFrame(&buf, FrameData, []byte("first"))
	WriteFrame(&buf, FrameData, []byte("second"))
	WriteFrame(&buf, FrameReplayEnd, nil)

	typ1, p1, _ := ReadFrame(&buf)
	typ2, p2, _ := ReadFrame(&buf)
	typ3, _, _ := ReadFrame(&buf)

	if typ1 != FrameData || string(p1) != "first" {
		t.Errorf("frame 1: type=%d payload=%q", typ1, p1)
	}
	if typ2 != FrameData || string(p2) != "second" {
		t.Errorf("frame 2: type=%d payload=%q", typ2, p2)
	}
	if typ3 != FrameReplayEnd {
		t.Errorf("frame 3: type=%d, want ReplayEnd", typ3)
	}
}
