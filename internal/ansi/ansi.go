package ansi

import (
	"regexp"

	stripansi "github.com/acarl005/stripansi"
)

var oscPattern = regexp.MustCompile(`(?s)\x1b\].*?(?:\x07|\x1b\\)`)

func StripString(s string) string {
	if s == "" {
		return ""
	}

	withoutOSC := oscPattern.ReplaceAllString(s, "")
	stripped := stripansi.Strip(withoutOSC)
	return oscPattern.ReplaceAllString(stripped, "")
}

func StripBytes(b []byte) []byte {
	if b == nil {
		return []byte{}
	}

	return []byte(StripString(string(b)))
}
