import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { UpdateInfo, UpdateProgress } from '$lib/types';

class UpdaterStore {
  isUpdateAvailable = $state(false);
  availableVersion = $state<string | null>(null);
  releaseNotes = $state<string | null>(null);
  isDownloading = $state(false);
  downloadedBytes = $state(0);
  totalBytes = $state<number | null>(null);
  isUpToDate = $state(false);

  setUpdateAvailable(info: UpdateInfo): void {
    this.isUpdateAvailable = info.available;
    this.availableVersion = info.version;
    this.releaseNotes = info.body;
    this.isUpToDate = !info.available;
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
    this.isUpToDate = false;
  }
}

export const updaterStore = new UpdaterStore();

export function initUpdaterListener(): () => void {
  let unlistenAvailable: (() => void) | undefined;
  let unlistenProgress: (() => void) | undefined;

  listen<UpdateInfo>('update-available', async (event) => {
    updaterStore.setUpdateAvailable(event.payload);
    try {
      if (await isPermissionGranted()) {
        sendNotification({
          title: 'Jackdaw Update Available',
          body: `Version ${event.payload.version} is ready to install`,
        });
      }
    } catch {
      // Notification permission denied — banner is the fallback
    }
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
