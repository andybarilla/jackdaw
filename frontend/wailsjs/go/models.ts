export namespace config {
	
	export class Config {
	    theme: string;
	    keybindings: Record<string, string>;
	    layout?: number[];
	    workspace_layouts?: Record<string, Array<number>>;
	    history_max_bytes?: number;
	    notifications_enabled: boolean;
	    desktop_notifications: boolean;
	    toast_duration_seconds?: number;
	    error_detection_enabled: boolean;
	    worktree_root?: string;
	    merge_mode?: string;
	    auto_remove_killed_sessions: boolean;
	    workspaces?: workspace.Workspace[];
	    active_workspace_id?: string;
	    terminal_font_family?: string;
	    terminal_font_size?: number;
	    ui_font_family?: string;
	    ui_font_size?: number;
	    shell_commands?: {name: string; command: string; work_dir?: string}[];

	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.keybindings = source["keybindings"];
	        this.layout = source["layout"];
	        this.workspace_layouts = source["workspace_layouts"];
	        this.history_max_bytes = source["history_max_bytes"];
	        this.notifications_enabled = source["notifications_enabled"];
	        this.desktop_notifications = source["desktop_notifications"];
	        this.toast_duration_seconds = source["toast_duration_seconds"];
	        this.error_detection_enabled = source["error_detection_enabled"];
	        this.worktree_root = source["worktree_root"];
	        this.merge_mode = source["merge_mode"];
	        this.auto_remove_killed_sessions = source["auto_remove_killed_sessions"];
	        this.workspaces = this.convertValues(source["workspaces"], workspace.Workspace);
	        this.active_workspace_id = source["active_workspace_id"];
	        this.terminal_font_family = source["terminal_font_family"];
	        this.terminal_font_size = source["terminal_font_size"];
	        this.ui_font_family = source["ui_font_family"];
	        this.ui_font_size = source["ui_font_size"];
	        this.shell_commands = source["shell_commands"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class RecentDir {
	    path: string;
	    // Go type: time
	    last_used: any;
	
	    static createFrom(source: any = {}) {
	        return new RecentDir(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.last_used = this.convertValues(source["last_used"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WorktreeStatusResult {
	    branch: string;
	    uncommitted_files: number;
	    unpushed_commits: number;
	
	    static createFrom(source: any = {}) {
	        return new WorktreeStatusResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.branch = source["branch"];
	        this.uncommitted_files = source["uncommitted_files"];
	        this.unpushed_commits = source["unpushed_commits"];
	    }
	}

}

export namespace session {
	
	export class DashboardSession {
	    id: string;
	    name: string;
	    work_dir: string;
	    status: string;
	    // Go type: time
	    started_at: any;
	    last_line: string;
	    workspace_id?: string;
	    worktree_enabled?: boolean;
	    branch_name?: string;
	
	    static createFrom(source: any = {}) {
	        return new DashboardSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.work_dir = source["work_dir"];
	        this.status = source["status"];
	        this.started_at = this.convertValues(source["started_at"], null);
	        this.last_line = source["last_line"];
	        this.workspace_id = source["workspace_id"];
	        this.worktree_enabled = source["worktree_enabled"];
	        this.branch_name = source["branch_name"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SessionInfo {
	    id: string;
	    name: string;
	    work_dir: string;
	    command: string;
	    status: string;
	    pid: number;
	    // Go type: time
	    started_at: any;
	    exit_code: number;
	    workspace_id?: string;
	    worktree_enabled?: boolean;
	    worktree_path?: string;
	    original_dir?: string;
	    branch_name?: string;
	    base_branch?: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.work_dir = source["work_dir"];
	        this.command = source["command"];
	        this.status = source["status"];
	        this.pid = source["pid"];
	        this.started_at = this.convertValues(source["started_at"], null);
	        this.exit_code = source["exit_code"];
	        this.workspace_id = source["workspace_id"];
	        this.worktree_enabled = source["worktree_enabled"];
	        this.worktree_path = source["worktree_path"];
	        this.original_dir = source["original_dir"];
	        this.branch_name = source["branch_name"];
	        this.base_branch = source["base_branch"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace terminal {
	
	export class TerminalInfo {
	    id: string;
	    work_dir: string;
	    pid: number;
	
	    static createFrom(source: any = {}) {
	        return new TerminalInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.work_dir = source["work_dir"];
	        this.pid = source["pid"];
	    }
	}

}

export namespace workspace {
	
	export class Workspace {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new Workspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}

}

export namespace worktree {
	
	export class DiffLine {
	    type: string;
	    content: string;
	    old_line?: number;
	    new_line?: number;
	
	    static createFrom(source: any = {}) {
	        return new DiffLine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.content = source["content"];
	        this.old_line = source["old_line"];
	        this.new_line = source["new_line"];
	    }
	}
	export class DiffHunk {
	    header: string;
	    lines: DiffLine[];
	
	    static createFrom(source: any = {}) {
	        return new DiffHunk(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.header = source["header"];
	        this.lines = this.convertValues(source["lines"], DiffLine);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class FileDiff {
	    path: string;
	    old_path?: string;
	    status: string;
	    hunks: DiffHunk[];
	    binary: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileDiff(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.old_path = source["old_path"];
	        this.status = source["status"];
	        this.hunks = this.convertValues(source["hunks"], DiffHunk);
	        this.binary = source["binary"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class MergeResult {
	    success: boolean;
	    commit_message?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new MergeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.commit_message = source["commit_message"];
	        this.error = source["error"];
	    }
	}

}

