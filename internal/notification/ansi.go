package notification

import "github.com/andybarilla/jackdaw/internal/ansi"

func StripANSI(data []byte) []byte {
	return ansi.StripBytes(data)
}
