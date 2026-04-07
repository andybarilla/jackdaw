package relay

import (
	"net"
	"sync"
)

type Client struct {
	conn        net.Conn
	mu          sync.Mutex
	OnOutput    func(data []byte)
	OnReplayEnd func()
}

func NewClient(sockPath string) (*Client, error) {
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		return nil, err
	}
	return &Client{conn: conn}, nil
}

func (c *Client) StartReadLoop() {
	go func() {
		for {
			typ, payload, err := ReadFrame(c.conn)
			if err != nil {
				return
			}
			switch typ {
			case FrameData:
				if c.OnOutput != nil {
					c.OnOutput(payload)
				}
			case FrameReplayEnd:
				if c.OnReplayEnd != nil {
					c.OnReplayEnd()
				}
			}
		}
	}()
}

func (c *Client) Write(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return WriteFrame(c.conn, FrameData, data)
}

func (c *Client) Resize(cols, rows uint16) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return WriteFrame(c.conn, FrameResize, EncodeResize(cols, rows))
}

func (c *Client) Close() error {
	return c.conn.Close()
}
