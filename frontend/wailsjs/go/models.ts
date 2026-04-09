export namespace config {
	
	export class Config {
	    theme: string;
	    keybindings: Record<string, string>;
	    layout?: number[];
	    history_max_bytes?: number;
	    notifications_enabled: boolean;
	    desktop_notifications: boolean;
	    toast_duration_seconds?: number;
	    error_detection_enabled: boolean;
	    worktree_root?: string;
	    merge_mode?: string;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.keybindings = source["keybindings"];
	        this.layout = source["layout"];
	        this.history_max_bytes = source["history_max_bytes"];
	        this.notifications_enabled = source["notifications_enabled"];
	        this.desktop_notifications = source["desktop_notifications"];
	        this.toast_duration_seconds = source["toast_duration_seconds"];
	        this.error_detection_enabled = source["error_detection_enabled"];
	        this.worktree_root = source["worktree_root"];
	        this.merge_mode = source["merge_mode"];
	    }
	}

}

export namespace main {
	
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

