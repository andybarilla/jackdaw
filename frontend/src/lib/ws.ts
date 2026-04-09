const MSG_TYPE_INPUT = 0x01;
const MSG_TYPE_RESIZE = 0x02;

const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 2000;
const RECONNECT_MAX_ATTEMPTS = 10;

export interface WSConnection {
  send(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export function connectSession(
  port: number,
  sessionId: string,
  onData: (data: Uint8Array) => void,
  onOpen?: () => void,
  onClose?: () => void,
): WSConnection {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function connect() {
    if (closed) return;

    ws = new WebSocket(`ws://127.0.0.1:${port}/ws/${sessionId}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      attempt = 0;
      onOpen?.();
    };

    ws.onmessage = (event: MessageEvent) => {
      onData(new Uint8Array(event.data as ArrayBuffer));
    };

    ws.onclose = () => {
      if (closed) return;
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  function scheduleReconnect() {
    if (closed || attempt >= RECONNECT_MAX_ATTEMPTS) {
      onClose?.();
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
    attempt++;
    reconnectTimer = setTimeout(connect, delay);
  }

  function send(data: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const encoded = new TextEncoder().encode(data);
    const msg = new Uint8Array(1 + encoded.length);
    msg[0] = MSG_TYPE_INPUT;
    msg.set(encoded, 1);
    ws.send(msg);
  }

  function resize(cols: number, rows: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = new Uint8Array(5);
    msg[0] = MSG_TYPE_RESIZE;
    const view = new DataView(msg.buffer);
    view.setUint16(1, cols, false); // big-endian
    view.setUint16(3, rows, false);
    ws.send(msg);
  }

  function close() {
    closed = true;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
    }
    ws?.close();
    ws = null;
  }

  connect();

  return { send, resize, close };
}
