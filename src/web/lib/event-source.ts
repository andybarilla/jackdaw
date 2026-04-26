export interface BrowserEventSource {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  close(): void;
}

export type EventSourceFactory = (url: string, serviceToken?: string) => BrowserEventSource;

export function createBrowserEventSource(url: string, serviceToken?: string): BrowserEventSource {
  return new FetchEventSource(url, serviceToken);
}

class FetchEventSource implements BrowserEventSource {
  private readonly eventTarget = new EventTarget();
  private readonly abortController = new AbortController();

  constructor(
    private readonly url: string,
    private readonly serviceToken: string | undefined,
  ) {
    void this.connect();
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.eventTarget.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.eventTarget.removeEventListener(type, listener);
  }

  close(): void {
    this.abortController.abort();
  }

  private async connect(): Promise<void> {
    try {
      const headers = new Headers();
      headers.set("Accept", "text/event-stream");
      if (this.serviceToken !== undefined) {
        headers.set("Authorization", `Bearer ${this.serviceToken}`);
      }

      const response = await fetch(this.url, {
        headers,
        signal: this.abortController.signal,
      });
      if (!response.ok || response.body === null) {
        this.dispatch("error", new Event("error"));
        return;
      }

      this.dispatch("open", new Event("open"));
      await this.readStream(response.body);
    } catch (error: unknown) {
      if (!this.abortController.signal.aborted) {
        this.dispatch("error", new Event("error"));
      }
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let bufferedText = "";

    while (!this.abortController.signal.aborted) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      bufferedText += decoder.decode(result.value, { stream: true });
      const normalizedText = bufferedText.replace(/\r\n/gu, "\n");
      const messages = normalizedText.split("\n\n");
      bufferedText = messages.pop() ?? "";
      for (const message of messages) {
        this.dispatchSseMessage(message);
      }
    }
  }

  private dispatchSseMessage(rawMessage: string): void {
    let eventType = "message";
    const dataLines: string[] = [];

    for (const line of rawMessage.split("\n")) {
      if (line.startsWith(":")) {
        continue;
      }

      const separatorIndex = line.indexOf(":");
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const value = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1).replace(/^ /u, "");
      if (field === "event") {
        eventType = value;
      } else if (field === "data") {
        dataLines.push(value);
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    this.dispatch(eventType, new MessageEvent(eventType, { data: dataLines.join("\n") }));
  }

  private dispatch(type: string, event: Event): void {
    this.eventTarget.dispatchEvent(event.type === type ? event : new Event(type));
  }
}
