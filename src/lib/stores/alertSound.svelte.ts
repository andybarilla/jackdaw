import type { AlertTier } from '$lib/types';

import alertHighUrl from '$lib/assets/sounds/alert-high.wav';
import alertMediumUrl from '$lib/assets/sounds/alert-medium.wav';
import alertLowUrl from '$lib/assets/sounds/alert-low.wav';

const SOUND_URLS: Record<string, string> = {
  high: alertHighUrl,
  medium: alertMediumUrl,
  low: alertLowUrl,
};

export function playAlertSound(tier: AlertTier, volume: number): void {
  if (tier === 'off' || volume <= 0) return;

  const url = SOUND_URLS[tier];
  if (!url) return;

  const audio = new Audio(url);
  audio.volume = Math.min(1, Math.max(0, volume / 100));
  audio.play().catch(() => {
    // Browser may block autoplay before user interaction — silently ignore
  });
}
