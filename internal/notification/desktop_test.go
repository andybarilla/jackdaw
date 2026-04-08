package notification

import (
	"runtime"
	"testing"
)

func TestDesktopNotifierBuildCommand(t *testing.T) {
	dn := &DesktopNotifier{}

	cmd := dn.buildCommand("my-project", "Session exited (code 0)")
	if cmd == nil {
		t.Fatal("expected non-nil command")
	}

	switch runtime.GOOS {
	case "linux":
		if cmd.Path == "" {
			t.Error("expected command path")
		}
		args := cmd.Args
		foundTitle := false
		for _, a := range args {
			if a == "my-project" {
				foundTitle = true
			}
		}
		if !foundTitle {
			t.Errorf("expected title in args, got %v", args)
		}
	case "darwin":
		if cmd.Args[0] != "osascript" {
			t.Errorf("expected osascript, got %s", cmd.Args[0])
		}
	case "windows":
		if cmd.Args[0] != "powershell" {
			t.Errorf("expected powershell, got %s", cmd.Args[0])
		}
	}
}
