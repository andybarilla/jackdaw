export interface BrowserEventSource {
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => BrowserEventSource;

export function createBrowserEventSource(url: string): BrowserEventSource {
  return new EventSource(url);
}
