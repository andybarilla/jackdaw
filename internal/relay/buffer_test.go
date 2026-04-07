package relay

import (
	"bytes"
	"testing"
)

func TestRingBufferBasic(t *testing.T) {
	rb := NewRingBuffer(1024)
	rb.Write([]byte("hello"))

	got := rb.Bytes()
	if !bytes.Equal(got, []byte("hello")) {
		t.Errorf("got %q, want %q", got, "hello")
	}
}

func TestRingBufferWrap(t *testing.T) {
	rb := NewRingBuffer(10)
	rb.Write([]byte("1234567890"))
	rb.Write([]byte("abc"))

	got := rb.Bytes()
	want := "4567890abc"
	if string(got) != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestRingBufferEmpty(t *testing.T) {
	rb := NewRingBuffer(1024)
	got := rb.Bytes()
	if len(got) != 0 {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestRingBufferExactFill(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("abcde"))
	got := rb.Bytes()
	if string(got) != "abcde" {
		t.Errorf("got %q, want %q", got, "abcde")
	}
}

func TestRingBufferMultipleSmallWrites(t *testing.T) {
	rb := NewRingBuffer(8)
	rb.Write([]byte("aa"))
	rb.Write([]byte("bb"))
	rb.Write([]byte("cc"))
	rb.Write([]byte("dd"))
	if string(rb.Bytes()) != "aabbccdd" {
		t.Errorf("got %q", rb.Bytes())
	}
	rb.Write([]byte("ee"))
	if string(rb.Bytes()) != "bbccddee" {
		t.Errorf("got %q, want %q", rb.Bytes(), "bbccddee")
	}
}

func TestRingBufferLargeWrite(t *testing.T) {
	rb := NewRingBuffer(5)
	rb.Write([]byte("abcdefghij"))
	if string(rb.Bytes()) != "fghij" {
		t.Errorf("got %q, want %q", rb.Bytes(), "fghij")
	}
}
