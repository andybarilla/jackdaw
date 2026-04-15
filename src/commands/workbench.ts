import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { getWorkbenchSupervisor } from "../orchestration/workbench.js";
import { showWorkbenchDashboard } from "../ui/dashboard.js";

export async function runWorkbenchCommand(ctx: ExtensionCommandContext): Promise<void> {
  const supervisor = getWorkbenchSupervisor(ctx.cwd);
  await showWorkbenchDashboard(ctx, supervisor);
}
