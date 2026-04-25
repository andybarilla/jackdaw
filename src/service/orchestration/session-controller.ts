export type SessionControllerLifecycle = "starting" | "live" | "reconnecting" | "disposing" | "disposed" | "failed";

export interface SessionControllerEvent<TPayload = unknown> {
  sessionId: string;
  generation: number;
  payload: TPayload;
}

export interface SessionController<TPayload = unknown> {
  readonly sessionId: string;
  readonly generation: number;
  readonly lifecycle: SessionControllerLifecycle;
  markLive(): void;
  markReconnecting(): void;
  markFailed(): void;
  dispose(): void;
  acceptsCommands(): boolean;
  acceptsEvent(event: SessionControllerEvent<TPayload>): boolean;
}

export function createSessionController<TPayload = unknown>(
  sessionId: string,
  generation: number = 1,
): SessionController<TPayload> {
  let lifecycle: SessionControllerLifecycle = "starting";

  const controller: SessionController<TPayload> = {
    sessionId,
    generation,

    get lifecycle(): SessionControllerLifecycle {
      return lifecycle;
    },

    markLive(): void {
      if (lifecycle === "disposing" || lifecycle === "disposed") {
        return;
      }

      lifecycle = "live";
    },

    markReconnecting(): void {
      if (lifecycle === "disposing" || lifecycle === "disposed") {
        return;
      }

      lifecycle = "reconnecting";
    },

    markFailed(): void {
      if (lifecycle === "disposing" || lifecycle === "disposed") {
        return;
      }

      lifecycle = "failed";
    },

    dispose(): void {
      if (lifecycle === "disposed") {
        return;
      }

      lifecycle = "disposed";
    },

    acceptsCommands(): boolean {
      return lifecycle !== "disposing" && lifecycle !== "disposed" && lifecycle !== "failed";
    },

    acceptsEvent(event: SessionControllerEvent<TPayload>): boolean {
      return event.sessionId === sessionId
        && event.generation === generation
        && lifecycle !== "disposing"
        && lifecycle !== "disposed";
    },
  };

  return controller;
}
