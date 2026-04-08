package notification

import "regexp"

var ansiPattern = regexp.MustCompile(`\x1b(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07)`)

func StripANSI(data []byte) []byte {
	return ansiPattern.ReplaceAll(data, nil)
}
