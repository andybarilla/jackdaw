import { describe, it, expect } from 'vitest';
import { extractUrlsFromText } from './urls';

describe('extractUrlsFromText', () => {
  it('extracts http URLs', () => {
    expect(extractUrlsFromText('visit http://example.com now')).toEqual([
      { url: 'http://example.com', start: 6, end: 24 },
    ]);
  });

  it('extracts https URLs', () => {
    expect(extractUrlsFromText('see https://example.com/path')).toEqual([
      { url: 'https://example.com/path', start: 4, end: 28 },
    ]);
  });

  it('extracts multiple URLs', () => {
    const result = extractUrlsFromText('https://a.com and https://b.com');
    expect(result).toHaveLength(2);
    expect(result[0].url).toBe('https://a.com');
    expect(result[1].url).toBe('https://b.com');
  });

  it('extracts localhost URLs with port', () => {
    expect(extractUrlsFromText('http://localhost:5173/page')).toEqual([
      { url: 'http://localhost:5173/page', start: 0, end: 26 },
    ]);
  });

  it('returns empty array for no URLs', () => {
    expect(extractUrlsFromText('just some text')).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(extractUrlsFromText(null)).toEqual([]);
    expect(extractUrlsFromText(undefined)).toEqual([]);
  });

  it('handles URLs at end of string', () => {
    const result = extractUrlsFromText('go to https://example.com');
    expect(result[0].url).toBe('https://example.com');
  });
});
