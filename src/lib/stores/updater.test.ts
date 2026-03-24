import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

const { updaterStore } = await import('./updater.svelte');

describe('UpdaterStore', () => {
  it('starts with no update available', () => {
    expect(updaterStore.isUpdateAvailable).toBe(false);
    expect(updaterStore.availableVersion).toBeNull();
    expect(updaterStore.releaseNotes).toBeNull();
  });

  it('starts not downloading', () => {
    expect(updaterStore.isDownloading).toBe(false);
    expect(updaterStore.downloadedBytes).toBe(0);
    expect(updaterStore.totalBytes).toBeNull();
  });

  it('setUpdateAvailable updates state', () => {
    updaterStore.setUpdateAvailable({
      available: true,
      version: '1.2.0',
      body: 'Bug fixes',
    });
    expect(updaterStore.isUpdateAvailable).toBe(true);
    expect(updaterStore.availableVersion).toBe('1.2.0');
    expect(updaterStore.releaseNotes).toBe('Bug fixes');
  });

  it('addProgress accumulates bytes', () => {
    updaterStore.startDownload();
    expect(updaterStore.isDownloading).toBe(true);

    updaterStore.addProgress({ chunk_length: 1000, content_length: 5000 });
    expect(updaterStore.downloadedBytes).toBe(1000);
    expect(updaterStore.totalBytes).toBe(5000);

    updaterStore.addProgress({ chunk_length: 2000, content_length: 5000 });
    expect(updaterStore.downloadedBytes).toBe(3000);
  });

  it('reset clears all state', () => {
    updaterStore.reset();
    expect(updaterStore.isUpdateAvailable).toBe(false);
    expect(updaterStore.availableVersion).toBeNull();
    expect(updaterStore.isDownloading).toBe(false);
    expect(updaterStore.downloadedBytes).toBe(0);
  });
});
