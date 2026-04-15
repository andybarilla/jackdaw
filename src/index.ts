import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runWorkbenchSpawnCommand } from "./commands/spawn-session.js";
import { runWorkbenchCommand } from "./commands/workbench.js";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("workbench", {
    description: "Open the Jackdaw workbench dashboard",
    handler: async (_args, ctx) => {
      await runWorkbenchCommand(ctx);
    },
  });

  pi.registerCommand("workbench-spawn", {
    description: "Spawn a tracked pi session for the workbench",
    handler: async (args, ctx) => {
      await runWorkbenchSpawnCommand(ctx, args);
    },
  });
}
