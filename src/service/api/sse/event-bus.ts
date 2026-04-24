import type { WorkspaceStreamEventDto } from "../../../shared/transport/dto.js";

const RETAINED_EVENT_COUNT: number = 100;

export interface WorkspaceEventEnvelope {
  id: string;
  event: WorkspaceStreamEventDto;
}

export interface WorkspaceReplayResult {
  canReplay: boolean;
  events: WorkspaceEventEnvelope[];
}

export interface WorkspaceEventBus {
  publish(workspaceId: string, event: WorkspaceStreamEventDto): WorkspaceEventEnvelope;
  createTransientEvent(workspaceId: string, event: WorkspaceStreamEventDto): WorkspaceEventEnvelope;
  replaySince(workspaceId: string, lastEventId: string): WorkspaceReplayResult | undefined;
  subscribe(workspaceId: string, listener: WorkspaceEventListener): () => void;
}

export type WorkspaceEventListener = (event: WorkspaceEventEnvelope) => void;

interface WorkspaceChannel {
  history: WorkspaceEventEnvelope[];
  listeners: Set<WorkspaceEventListener>;
  nextEventId: number;
}

export function createWorkspaceEventBus(): WorkspaceEventBus {
  const channelsByWorkspaceId: Map<string, WorkspaceChannel> = new Map<string, WorkspaceChannel>();

  const getChannel = (workspaceId: string): WorkspaceChannel => {
    const existingChannel = channelsByWorkspaceId.get(workspaceId);
    if (existingChannel !== undefined) {
      return existingChannel;
    }

    const createdChannel: WorkspaceChannel = {
      history: [],
      listeners: new Set<WorkspaceEventListener>(),
      nextEventId: 1,
    };
    channelsByWorkspaceId.set(workspaceId, createdChannel);
    return createdChannel;
  };

  const createEnvelope = (workspaceId: string, event: WorkspaceStreamEventDto): WorkspaceEventEnvelope => {
    const channel = getChannel(workspaceId);
    const envelope: WorkspaceEventEnvelope = {
      id: String(channel.nextEventId),
      event,
    };
    channel.nextEventId += 1;
    return envelope;
  };

  return {
    publish(workspaceId: string, event: WorkspaceStreamEventDto): WorkspaceEventEnvelope {
      const channel = getChannel(workspaceId);
      const envelope = createEnvelope(workspaceId, event);

      channel.history.push(envelope);
      if (channel.history.length > RETAINED_EVENT_COUNT) {
        channel.history.splice(0, channel.history.length - RETAINED_EVENT_COUNT);
      }

      for (const listener of Array.from(channel.listeners)) {
        try {
          listener(envelope);
        } catch {
          channel.listeners.delete(listener);
        }
      }

      return envelope;
    },

    createTransientEvent(workspaceId: string, event: WorkspaceStreamEventDto): WorkspaceEventEnvelope {
      return createEnvelope(workspaceId, event);
    },

    replaySince(workspaceId: string, lastEventId: string): WorkspaceReplayResult | undefined {
      const parsedLastEventId = Number(lastEventId);
      if (!Number.isInteger(parsedLastEventId) || parsedLastEventId < 0) {
        return undefined;
      }

      const channel = channelsByWorkspaceId.get(workspaceId);
      if (channel === undefined || channel.history.length === 0) {
        return {
          canReplay: false,
          events: [],
        };
      }

      const oldestRetainedEventId = Number(channel.history[0]?.id);
      if (parsedLastEventId < oldestRetainedEventId - 1) {
        return undefined;
      }

      return {
        canReplay: true,
        events: channel.history.filter((entry) => Number(entry.id) > parsedLastEventId),
      };
    },

    subscribe(workspaceId: string, listener: WorkspaceEventListener): () => void {
      const channel = getChannel(workspaceId);
      channel.listeners.add(listener);

      return (): void => {
        const currentChannel = channelsByWorkspaceId.get(workspaceId);
        if (currentChannel === undefined) {
          return;
        }

        currentChannel.listeners.delete(listener);
      };
    },
  };
}
