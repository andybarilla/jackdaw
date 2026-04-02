import { describe, it, expect } from 'vitest';
import { normalizeToolName } from './tools';

describe('normalizeToolName', () => {
  it('normalizes Claude Code tool names', () => {
    expect(normalizeToolName('claude-code', 'Bash')).toBe('shell');
    expect(normalizeToolName('claude-code', 'Read')).toBe('file_read');
    expect(normalizeToolName('claude-code', 'Write')).toBe('file_write');
    expect(normalizeToolName('claude-code', 'Edit')).toBe('file_edit');
    expect(normalizeToolName('claude-code', 'Glob')).toBe('file_search');
    expect(normalizeToolName('claude-code', 'Grep')).toBe('content_search');
    expect(normalizeToolName('claude-code', 'Agent')).toBe('agent');
    expect(normalizeToolName('claude-code', 'WebFetch')).toBe('web_fetch');
    expect(normalizeToolName('claude-code', 'WebSearch')).toBe('web_search');
  });

  it('normalizes OpenCode tool names', () => {
    expect(normalizeToolName('opencode', 'bash')).toBe('shell');
    expect(normalizeToolName('opencode', 'shell')).toBe('shell');
    expect(normalizeToolName('opencode', 'read')).toBe('file_read');
    expect(normalizeToolName('opencode', 'write')).toBe('file_write');
    expect(normalizeToolName('opencode', 'edit')).toBe('file_edit');
    expect(normalizeToolName('opencode', 'glob')).toBe('file_search');
    expect(normalizeToolName('opencode', 'grep')).toBe('content_search');
    expect(normalizeToolName('opencode', 'agent')).toBe('agent');
    expect(normalizeToolName('opencode', 'subagent')).toBe('agent');
    expect(normalizeToolName('opencode', 'web_fetch')).toBe('web_fetch');
    expect(normalizeToolName('opencode', 'web_search')).toBe('web_search');
  });

  it('passes through unknown tool names unchanged', () => {
    expect(normalizeToolName('claude-code', 'UnknownTool')).toBe('UnknownTool');
    expect(normalizeToolName('opencode', 'custom_tool')).toBe('custom_tool');
  });

  it('passes through unknown sources unchanged', () => {
    expect(normalizeToolName('aider', 'Bash')).toBe('Bash');
  });
});
