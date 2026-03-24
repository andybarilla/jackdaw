<script lang="ts">
  import { onMount } from 'svelte';
  import { Store } from '@tauri-apps/plugin-store';

  interface NotificationPrefs {
    on_approval_needed: boolean;
    on_session_end: boolean;
    on_stop: boolean;
  }

  let prefs = $state<NotificationPrefs>({
    on_approval_needed: true,
    on_session_end: true,
    on_stop: true,
  });

  let store: Awaited<ReturnType<typeof Store.load>> | null = $state(null);

  onMount(async () => {
    store = await Store.load('settings.json');
    const saved = await store.get<NotificationPrefs>('notifications');
    if (saved) {
      prefs = saved;
    }
  });

  async function toggle(key: keyof NotificationPrefs) {
    prefs[key] = !prefs[key];
    if (store) {
      await store.set('notifications', prefs);
      await store.save();
    }
  }
</script>

<div class="settings">
  <h3 class="settings-title">Notifications</h3>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_approval_needed} onchange={() => toggle('on_approval_needed')} />
    <span>Notify when approval needed</span>
  </label>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_stop} onchange={() => toggle('on_stop')} />
    <span>Notify when waiting for input</span>
  </label>
  <label class="toggle-row">
    <input type="checkbox" checked={prefs.on_session_end} onchange={() => toggle('on_session_end')} />
    <span>Notify when session ends</span>
  </label>
</div>

<style>
  .settings {
    padding: 16px;
  }

  .settings-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px 0;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .toggle-row input[type="checkbox"] {
    accent-color: var(--active);
  }
</style>
