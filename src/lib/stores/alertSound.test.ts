import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playAlertSound } from './alertSound.svelte';

// Mock HTMLAudioElement
const mockPlay = vi.fn().mockResolvedValue(undefined);
const mockAudio = { play: mockPlay, volume: 1 };

vi.stubGlobal('Audio', vi.fn(function () { return mockAudio; }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('playAlertSound', () => {
  it('plays high alert sound', () => {
    playAlertSound('high', 80);
    expect(Audio).toHaveBeenCalled();
    expect(mockAudio.volume).toBe(0.8);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('plays medium alert sound', () => {
    playAlertSound('medium', 50);
    expect(mockAudio.volume).toBe(0.5);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('plays low alert sound', () => {
    playAlertSound('low', 100);
    expect(mockAudio.volume).toBe(1);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('does not play for off tier', () => {
    playAlertSound('off', 80);
    expect(Audio).not.toHaveBeenCalled();
  });

  it('does not play at zero volume', () => {
    playAlertSound('high', 0);
    expect(Audio).not.toHaveBeenCalled();
  });
});
