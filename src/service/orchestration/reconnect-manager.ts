import { RuntimeManager, type ReconnectSessionResult } from "./runtime-manager.js";

export interface ReconnectManagerOptions {
  runtimeManager: RuntimeManager;
}

export class ReconnectManager {
  private readonly runtimeManager: RuntimeManager;

  constructor(runtimeManagerOrOptions: RuntimeManager | ReconnectManagerOptions) {
    this.runtimeManager = runtimeManagerOrOptions instanceof RuntimeManager
      ? runtimeManagerOrOptions
      : runtimeManagerOrOptions.runtimeManager;
  }

  async reconnectAll(): Promise<ReconnectSessionResult[]> {
    return await this.runtimeManager.reconnectPersistedSessions();
  }

  async reconnectWorkspace(workspaceId: string): Promise<ReconnectSessionResult[]> {
    return await this.runtimeManager.reconnectPersistedSessions(workspaceId);
  }
}
