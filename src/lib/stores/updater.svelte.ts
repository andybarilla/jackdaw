import { listen } from '@tauri-apps/api/event';
import type { UpdateInfo, UpdateProgress } from '$lib/types';

class UpdaterStore {
  isUpdateAvailable = $state(false);
  availableVersion = $state<string | null>(null);
  releaseNotes = $state<string | null>(null);
  isDownloading = $state(false);
  downloadedBytes = $state(0);
  totalBytes = $state<number | null>(null);

  setUpdateAvailable(info: UpdateInfo): void {
    this.isUpdateAvailable = info.available;
    this.availableVersion = info.version;
    this.releaseNotes = info.body;
  }

  startDownload(): void {
    this.isDownloading = true;
    this.downloadedBytes = 0;
    this.totalBytes = null;
  }

  addProgress(progress: UpdateProgress): void {
    this.downloadedBytes += progress.chunk_length;
    if (progress.content_length !== null) {
      this.totalBytes = progress.content_length;
    }
  }

  reset(): void {
    this.isUpdateAvailable = false;
    this.availableVersion = null;
    this.releaseNotes = null;
    this.isDownloading = false;
    this.downloadedBytes = 0;
    this.totalBytes = null;
  }
}

export const updaterStore = new UpdaterStore();

export function initUpdaterListener(): () => void {
  let unlistenAvailable: (() => void) | undefined;
  let unlistenProgress: (() => void) | undefined;

  listen<UpdateInfo>('update-available', (event) => {
    updaterStore.setUpdateAvailable(event.payload);
  }).then((fn) => {
    unlistenAvailable = fn;
  });

  listen<UpdateProgress>('update-progress', (event) => {
    updaterStore.addProgress(event.payload);
  }).then((fn) => {
    unlistenProgress = fn;
  });

  return () => {
    unlistenAvailable?.();
    unlistenProgress?.();
  };
}
