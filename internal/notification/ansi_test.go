package notification

import "testing"

func TestStripANSIRemovesColorCodes(t *testing.T) {
	input := []byte("\x1b[31merror: something failed\x1b[0m")
	got := string(StripANSI(input))
	want := "error: something failed"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestStripANSIPreservesPlainText(t *testing.T) {
	input := []byte("just normal text")
	got := string(StripANSI(input))
	if got != "just normal text" {
		t.Errorf("got %q, want plain text unchanged", got)
	}
}

func TestStripANSIHandlesMultipleSequences(t *testing.T) {
	input := []byte("\x1b[1m\x1b[33mwarning:\x1b[0m something happened")
	got := string(StripANSI(input))
	want := "warning: something happened"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestStripANSIHandlesOSCSequences(t *testing.T) {
	input := []byte("\x1b]0;title\x07error: failed")
	got := string(StripANSI(input))
	want := "error: failed"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestStripANSIEmptyInput(t *testing.T) {
	got := StripANSI(nil)
	if len(got) != 0 {
		t.Errorf("expected empty, got %q", got)
	}
}
