package notification

import (
	"fmt"
	"os/exec"
	"runtime"
)

type DesktopNotifier struct {
	Enabled bool
}

func NewDesktopNotifier() *DesktopNotifier {
	return &DesktopNotifier{Enabled: true}
}

func (dn *DesktopNotifier) Send(title string, message string) {
	if !dn.Enabled {
		return
	}
	cmd := dn.buildCommand(title, message)
	if cmd == nil {
		return
	}
	// Fire and forget — don't block on notification delivery
	go cmd.Run()
}

func (dn *DesktopNotifier) buildCommand(title string, message string) *exec.Cmd {
	switch runtime.GOOS {
	case "linux":
		return exec.Command("notify-send", "--app-name=Jackdaw", title, message)
	case "darwin":
		script := fmt.Sprintf(`display notification %q with title %q`, message, title)
		return exec.Command("osascript", "-e", script)
	case "windows":
		script := fmt.Sprintf(
			`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; `+
				`$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); `+
				`$textNodes = $template.GetElementsByTagName('text'); `+
				`$textNodes.Item(0).AppendChild($template.CreateTextNode('%s')) | Out-Null; `+
				`$textNodes.Item(1).AppendChild($template.CreateTextNode('%s')) | Out-Null; `+
				`$toast = [Windows.UI.Notifications.ToastNotification]::new($template); `+
				`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Jackdaw').Show($toast)`,
			title, message,
		)
		return exec.Command("powershell", "-NoProfile", "-Command", script)
	default:
		return nil
	}
}
