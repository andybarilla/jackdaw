import { describe, it, expect } from 'vitest';
import { isPreviewableFile } from './files';

describe('isPreviewableFile', () => {
  it('returns true for .md files', () => {
    expect(isPreviewableFile('/home/user/docs/plan.md')).toBe(true);
  });

  it('returns true for .MD files (case insensitive)', () => {
    expect(isPreviewableFile('/docs/README.MD')).toBe(true);
  });

  it('returns true for .Md files (mixed case)', () => {
    expect(isPreviewableFile('/docs/notes.Md')).toBe(true);
  });

  it('returns false for non-markdown files', () => {
    expect(isPreviewableFile('/src/main.rs')).toBe(false);
    expect(isPreviewableFile('/src/app.txt')).toBe(false);
    expect(isPreviewableFile('/src/index.html')).toBe(false);
  });

  it('returns false for files with no extension', () => {
    expect(isPreviewableFile('/src/Makefile')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPreviewableFile(null)).toBe(false);
    expect(isPreviewableFile(undefined)).toBe(false);
  });
});
