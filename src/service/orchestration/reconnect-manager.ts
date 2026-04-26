import type { ReconnectSessionResult } from "./runtime-manager.js";

export interface ReconnectRuntime {
  reconnectPersistedSessions(workspaceId?: string): Promise<ReconnectSessionResult[]>;
}

export interface ReconnectManagerOptions {
  runtimeManager: ReconnectRuntime;
}

export class ReconnectManager {
  private readonly runtimeManager: ReconnectRuntime;

  constructor(runtimeManagerOrOptions: ReconnectRuntime | ReconnectManagerOptions) {
    this.runtimeManager = "runtimeManager" in runtimeManagerOrOptions
      ? runtimeManagerOrOptions.runtimeManager
      : runtimeManagerOrOptions;
  }

  async reconnectAll(): Promise<ReconnectSessionResult[]> {
    return await this.runtimeManager.reconnectPersistedSessions();
  }

  async reconnectWorkspace(workspaceId: string): Promise<ReconnectSessionResult[]> {
    return await this.runtimeManager.reconnectPersistedSessions(workspaceId);
  }
}
