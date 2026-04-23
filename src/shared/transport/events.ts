import type { WorkspaceStreamEventDto } from "./dto.js";

export interface ServiceEventEnvelope<TType extends string, TPayload> {
  version: 1;
  type: TType;
  payload: TPayload;
}

export type ServiceLifecycleEvent = ServiceEventEnvelope<"service.ready", { at: string }>;

export type WorkspaceStreamEvent = WorkspaceStreamEventDto | ServiceLifecycleEvent;
