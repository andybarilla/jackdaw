import {
  createAgentSession,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { PiSessionHistoryEntry } from "./event-normalizer.js";

export type PiSessionEventListener = (event: AgentSessionEvent | unknown) => void | Promise<void>;

export interface SpawnPiSessionOptions {
  workspaceId: string;
  cwd: string;
  task: string;
  modelId?: string;
  agentName?: string;
}

export interface ReconnectPiSessionOptions {
  workspaceId: string;
  sessionId: string;
  cwd: string;
  sessionFile: string;
  modelId?: string;
  agentName?: string;
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
    const { session } = await createAgentSession({
      cwd: options.cwd,
      agentDir: this.options.agentDir,
      sessionManager,
    });

    return new AgentManagedPiSession(session);
  }

  async reconnectSession(options: ReconnectPiSessionOptions): Promise<ManagedPiSession> {
    const sessionManager = SessionManager.open(options.sessionFile, this.options.sessionDirectory, options.cwd);
    const { session } = await createAgentSession({
      cwd: options.cwd,
      agentDir: this.options.agentDir,
      sessionManager,
    });

    return new AgentManagedPiSession(session);
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
      void listener(event);
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
