package relay

import (
	"encoding/binary"
	"fmt"
	"io"
)

type FrameType byte

const (
	FrameData      FrameType = 1
	FrameResize    FrameType = 2
	FrameReplayEnd FrameType = 3
)

func WriteFrame(w io.Writer, typ FrameType, payload []byte) error {
	header := make([]byte, 5)
	header[0] = byte(typ)
	binary.BigEndian.PutUint32(header[1:5], uint32(len(payload)))
	if _, err := w.Write(header); err != nil {
		return err
	}
	if len(payload) > 0 {
		_, err := w.Write(payload)
		return err
	}
	return nil
}

func ReadFrame(r io.Reader) (FrameType, []byte, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, nil, fmt.Errorf("read frame header: %w", err)
	}
	typ := FrameType(header[0])
	length := binary.BigEndian.Uint32(header[1:5])
	if length == 0 {
		return typ, nil, nil
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, fmt.Errorf("read frame payload: %w", err)
	}
	return typ, payload, nil
}

func EncodeResize(cols, rows uint16) []byte {
	buf := make([]byte, 4)
	binary.BigEndian.PutUint16(buf[0:2], cols)
	binary.BigEndian.PutUint16(buf[2:4], rows)
	return buf
}

func DecodeResize(data []byte) (cols, rows uint16) {
	cols = binary.BigEndian.Uint16(data[0:2])
	rows = binary.BigEndian.Uint16(data[2:4])
	return
}
