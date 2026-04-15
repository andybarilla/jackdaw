import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getWorkbenchSupervisor } from "../orchestration/workbench.js";

export async function runWorkbenchSpawnCommand(ctx: ExtensionCommandContext, args: string): Promise<void> {
  const supervisor = getWorkbenchSupervisor(ctx.cwd);
  await supervisor.initialize();

  const task = args.trim() || (await ctx.ui.input("New session task", "Describe the task to run"))?.trim();
  if (!task) {
    ctx.ui.notify("Cancelled: no task provided", "info");
    return;
  }

  const name = await ctx.ui.input("Session name", "Optional display name");
  const session = await supervisor.spawnSession({
    cwd: ctx.cwd,
    task,
    name: name?.trim() || undefined,
    tags: ["prototype"],
    model: ctx.model,
  });

  ctx.ui.notify(`Spawned ${session.name}`, "info");
}
