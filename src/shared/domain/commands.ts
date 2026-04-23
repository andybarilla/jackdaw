export interface SpawnSessionCommand {
  workspaceId: string;
  cwd: string;
  task: string;
  name?: string;
  repoRoot?: string;
  worktree?: string;
  branch?: string;
  model?: string;
  agent?: string;
  linkedArtifactIds?: string[];
  linkedWorkItemIds?: string[];
}

export interface SteerSessionCommand {
  sessionId: string;
  text: string;
}

export interface FollowUpSessionCommand {
  sessionId: string;
  text: string;
}

export interface AbortSessionCommand {
  sessionId: string;
}

export interface PinSummaryCommand {
  sessionId: string;
  summary?: string;
}

export interface OpenPathCommand {
  workspaceId: string;
  path: string;
  revealInFileManager?: boolean;
  openInTerminal?: boolean;
}

export interface ShellFallbackCommand {
  sessionId: string;
  command: string;
}

export interface CommandAccepted {
  ok: true;
  acceptedAt: string;
}

export interface CommandRejected {
  ok: false;
  reason: string;
}

export type CommandResult = CommandAccepted | CommandRejected;
