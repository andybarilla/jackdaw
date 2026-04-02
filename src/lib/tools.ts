const DISPLAY_NAMES: Record<string, string> = {
  shell: 'Shell',
  file_read: 'File Read',
  file_write: 'File Write',
  file_edit: 'File Edit',
  file_search: 'File Search',
  content_search: 'Content Search',
  agent: 'Agent',
  web_fetch: 'Web Fetch',
  web_search: 'Web Search',
};

export function displayToolName(toolName: string): string {
  return DISPLAY_NAMES[toolName] ?? toolName;
}
