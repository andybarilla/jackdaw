import type { WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";

export interface WorkspaceEventBus {
  publish(workspaceId: string, event: WorkspaceStreamEventDto): void;
  subscribe(workspaceId: string, listener: WorkspaceEventListener): () => void;
}

export type WorkspaceEventListener = (event: WorkspaceStreamEventDto) => void;

export function createWorkspaceEventBus(): WorkspaceEventBus {
  const listenersByWorkspaceId: Map<string, Set<WorkspaceEventListener>> = new Map<string, Set<WorkspaceEventListener>>();

  return {
    publish(workspaceId: string, event: WorkspaceStreamEventDto): void {
      const listeners = listenersByWorkspaceId.get(workspaceId);
      if (listeners === undefined) {
        return;
      }

      for (const listener of listeners) {
        listener(event);
      }
    },

    subscribe(workspaceId: string, listener: WorkspaceEventListener): () => void {
      const existingListeners = listenersByWorkspaceId.get(workspaceId) ?? new Set<WorkspaceEventListener>();
      existingListeners.add(listener);
      listenersByWorkspaceId.set(workspaceId, existingListeners);

      return (): void => {
        const currentListeners = listenersByWorkspaceId.get(workspaceId);
        if (currentListeners === undefined) {
          return;
        }

        currentListeners.delete(listener);
        if (currentListeners.size === 0) {
          listenersByWorkspaceId.delete(workspaceId);
        }
      };
    },
  };
}
