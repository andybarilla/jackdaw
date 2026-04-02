import { describe, it, expect } from 'vitest';
import { displayToolName } from './tools';

describe('displayToolName', () => {
  it('converts canonical names to human-friendly labels', () => {
    expect(displayToolName('shell')).toBe('Shell');
    expect(displayToolName('file_read')).toBe('File Read');
    expect(displayToolName('file_write')).toBe('File Write');
    expect(displayToolName('file_edit')).toBe('File Edit');
    expect(displayToolName('file_search')).toBe('File Search');
    expect(displayToolName('content_search')).toBe('Content Search');
    expect(displayToolName('agent')).toBe('Agent');
    expect(displayToolName('web_fetch')).toBe('Web Fetch');
    expect(displayToolName('web_search')).toBe('Web Search');
  });

  it('passes through Claude Code names unchanged', () => {
    expect(displayToolName('Bash')).toBe('Bash');
    expect(displayToolName('Read')).toBe('Read');
    expect(displayToolName('Agent')).toBe('Agent');
  });

  it('passes through unknown names unchanged', () => {
    expect(displayToolName('CustomTool')).toBe('CustomTool');
  });
});
