import { WorkbenchSupervisor } from "./supervisor.js";

const supervisors = new Map<string, WorkbenchSupervisor>();

export function getWorkbenchSupervisor(projectRoot: string): WorkbenchSupervisor {
  let supervisor = supervisors.get(projectRoot);
  if (!supervisor) {
    supervisor = new WorkbenchSupervisor(projectRoot);
    supervisors.set(projectRoot, supervisor);
  }
  return supervisor;
}
