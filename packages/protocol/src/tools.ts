type ToolMap = Record<string, string>;

const TOOL_MAPS: Record<string, ToolMap> = {
  'claude-code': {
    Bash: 'shell',
    Read: 'file_read',
    Write: 'file_write',
    Edit: 'file_edit',
    Glob: 'file_search',
    Grep: 'content_search',
    Agent: 'agent',
    WebFetch: 'web_fetch',
    WebSearch: 'web_search',
  },
  opencode: {
    bash: 'shell',
    shell: 'shell',
    read: 'file_read',
    write: 'file_write',
    edit: 'file_edit',
    glob: 'file_search',
    grep: 'content_search',
    agent: 'agent',
    subagent: 'agent',
    web_fetch: 'web_fetch',
    web_search: 'web_search',
  },
};

export function normalizeToolName(source: string, toolName: string): string {
  return TOOL_MAPS[source]?.[toolName] ?? toolName;
}
