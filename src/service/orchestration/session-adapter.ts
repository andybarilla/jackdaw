import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type CreateAgentSessionOptions,
} from "@mariozechner/pi-coding-agent";
import type { PiSessionHistoryEntry } from "./event-normalizer.js";

export type PiSessionEventListener = (event: AgentSessionEvent | unknown) => void | Promise<void>;

export interface SpawnPiSessionOptions {
  workspaceId: string;
  cwd: string;
  task: string;
  modelId?: string;
}

export interface ReconnectPiSessionOptions {
  workspaceId: string;
  sessionId: string;
  cwd: string;
  sessionFile: string;
  modelId?: string;
}

export interface ManagedPiSession {
  readonly sessionId: string;
  readonly sessionFile?: string;
  readonly modelId?: string;
  subscribe(listener: PiSessionEventListener): () => void;
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  dispose?(): void | Promise<void>;
  getHistoryEntries?(): readonly PiSessionHistoryEntry[];
}

export interface PiSessionAdapter {
  spawnSession(options: SpawnPiSessionOptions): Promise<ManagedPiSession>;
  reconnectSession(options: ReconnectPiSessionOptions): Promise<ManagedPiSession>;
}

export interface DefaultPiSessionAdapterOptions {
  sessionDirectory: string;
  agentDir?: string;
}

export class DefaultPiSessionAdapter implements PiSessionAdapter {
  constructor(private readonly options: DefaultPiSessionAdapterOptions) {}

  async spawnSession(options: SpawnPiSessionOptions): Promise<ManagedPiSession> {
    const sessionManager = SessionManager.create(options.cwd, this.options.sessionDirectory);
    const { session } = await createAgentSession(
      this.createAgentSessionOptions(options.cwd, sessionManager, options.modelId),
    );

    return new AgentManagedPiSession(session);
  }

  async reconnectSession(options: ReconnectPiSessionOptions): Promise<ManagedPiSession> {
    const sessionManager = SessionManager.open(options.sessionFile, this.options.sessionDirectory, options.cwd);
    const { session } = await createAgentSession(
      this.createAgentSessionOptions(options.cwd, sessionManager, options.modelId),
    );

    return new AgentManagedPiSession(session);
  }

  private createAgentSessionOptions(
    cwd: string,
    sessionManager: SessionManager,
    modelId: string | undefined,
  ): CreateAgentSessionOptions {
    const agentSessionOptions: CreateAgentSessionOptions = {
      cwd,
      agentDir: this.options.agentDir,
      sessionManager,
    };
    const requestedModelId = modelId?.trim();
    if (requestedModelId === undefined || requestedModelId.length === 0) {
      return agentSessionOptions;
    }

    const modelRegistry = createModelRegistry(this.options.agentDir);
    return {
      ...agentSessionOptions,
      modelRegistry,
      model: resolveRequestedModel(modelRegistry, requestedModelId),
    };
  }
}

class AgentManagedPiSession implements ManagedPiSession {
  constructor(private readonly session: AgentSession) {}

  get sessionId(): string {
    return this.session.sessionId;
  }

  get sessionFile(): string | undefined {
    return this.session.sessionFile;
  }

  get modelId(): string | undefined {
    return this.session.model?.id;
  }

  subscribe(listener: PiSessionEventListener): () => void {
    return this.session.subscribe((event: AgentSessionEvent): void => {
      void Promise.resolve(listener(event)).catch((error: unknown): void => {
        queueMicrotask((): void => {
          throw error;
        });
      });
    });
  }

  async prompt(text: string): Promise<void> {
    await this.session.prompt(text);
  }

  async steer(text: string): Promise<void> {
    await this.session.steer(text);
  }

  async followUp(text: string): Promise<void> {
    await this.session.followUp(text);
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  dispose(): void {
    this.session.dispose();
  }

  getHistoryEntries(): readonly PiSessionHistoryEntry[] {
    return this.session.sessionManager.getBranch() as unknown as readonly PiSessionHistoryEntry[];
  }
}

function createModelRegistry(agentDir: string | undefined): ModelRegistry {
  const authPath = agentDir === undefined ? undefined : path.join(agentDir, "auth.json");
  const modelsPath = agentDir === undefined ? undefined : path.join(agentDir, "models.json");
  const authStorage = AuthStorage.create(authPath);
  return ModelRegistry.create(authStorage, modelsPath);
}

function resolveRequestedModel(
  modelRegistry: ModelRegistry,
  requestedModelId: string,
): CreateAgentSessionOptions["model"] {
  const providerSeparatorIndex = requestedModelId.indexOf("/");
  if (providerSeparatorIndex > 0 && providerSeparatorIndex < requestedModelId.length - 1) {
    const provider = requestedModelId.slice(0, providerSeparatorIndex);
    const modelId = requestedModelId.slice(providerSeparatorIndex + 1);
    const model = modelRegistry.find(provider, modelId);
    if (model === undefined) {
      throw new Error(`Requested pi model was not found: ${requestedModelId}`);
    }

    return model;
  }

  const matchingModels = modelRegistry.getAll().filter((model) => model.id === requestedModelId);
  if (matchingModels.length === 1) {
    return matchingModels[0];
  }
  if (matchingModels.length > 1) {
    throw new Error(`Requested pi model is ambiguous; use provider/model: ${requestedModelId}`);
  }

  throw new Error(`Requested pi model was not found: ${requestedModelId}`);
}
