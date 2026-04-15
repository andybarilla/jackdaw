package ansi

import "testing"

func TestStripStringRemovesColorCodes(t *testing.T) {
	input := "\x1b[31merror: something failed\x1b[0m"
	got := StripString(input)
	want := "error: something failed"
	if got != want {
		t.Fatalf("StripString() = %q, want %q", got, want)
	}
}

func TestStripBytesRemovesMultipleCSISequences(t *testing.T) {
	input := []byte("\x1b[1m\x1b[33mwarning:\x1b[0m something happened")
	got := string(StripBytes(input))
	want := "warning: something happened"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesRemovesOSCBELSequence(t *testing.T) {
	input := []byte("\x1b]0;title\x07error: failed")
	got := string(StripBytes(input))
	want := "error: failed"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesRemovesOSCSTSequence(t *testing.T) {
	input := []byte("\x1b]0;title\x1b\\build failed")
	got := string(StripBytes(input))
	want := "build failed"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesPreservesPlainText(t *testing.T) {
	input := []byte("just normal text")
	got := string(StripBytes(input))
	want := "just normal text"
	if got != want {
		t.Fatalf("StripBytes() = %q, want %q", got, want)
	}
}

func TestStripBytesHandlesNilInput(t *testing.T) {
	got := StripBytes(nil)
	if len(got) != 0 {
		t.Fatalf("len(StripBytes(nil)) = %d, want 0", len(got))
	}
}
