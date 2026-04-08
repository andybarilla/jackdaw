<script lang="ts">
  import type { AppNotification } from "./types";
  import { getNotifications, dismissNotification } from "./notifications.svelte";
  import { DismissNotification } from "../../wailsjs/go/main/App";

  interface Props {
    toastDuration: number;
    onGoToSession: (sessionID: string) => void;
  }

  let { toastDuration, onGoToSession }: Props = $props();

  let visibleToasts = $state<Record<string, ReturnType<typeof setTimeout>>>({});
  let hoveredToasts = $state<Set<string>>(new Set());
  let notifications = $derived(getNotifications());

  // Track new notifications and set auto-dismiss timers
  $effect(() => {
    for (const sessionID of Object.keys(notifications)) {
      if (!(sessionID in visibleToasts)) {
        const timer = setTimeout(() => {
          handleDismiss(sessionID);
        }, toastDuration * 1000);
        visibleToasts = { ...visibleToasts, [sessionID]: timer };
      }
    }
    // Clean up timers for dismissed notifications
    for (const sessionID of Object.keys(visibleToasts)) {
      if (!(sessionID in notifications)) {
        clearTimeout(visibleToasts[sessionID]);
        const { [sessionID]: _, ...rest } = visibleToasts;
        visibleToasts = rest;
      }
    }
  });

  function handleDismiss(sessionID: string): void {
    if (hoveredToasts.has(sessionID)) return;
    dismissNotification(sessionID);
    DismissNotification(sessionID);
    if (sessionID in visibleToasts) {
      clearTimeout(visibleToasts[sessionID]);
      const { [sessionID]: _, ...rest } = visibleToasts;
      visibleToasts = rest;
    }
  }

  function handleGoTo(sessionID: string): void {
    onGoToSession(sessionID);
    handleDismiss(sessionID);
  }

  function handleMouseEnter(sessionID: string): void {
    hoveredToasts = new Set([...hoveredToasts, sessionID]);
    if (sessionID in visibleToasts) {
      clearTimeout(visibleToasts[sessionID]);
    }
  }

  function handleMouseLeave(sessionID: string): void {
    const next = new Set(hoveredToasts);
    next.delete(sessionID);
    hoveredToasts = next;
    const timer = setTimeout(() => {
      handleDismiss(sessionID);
    }, toastDuration * 1000);
    visibleToasts = { ...visibleToasts, [sessionID]: timer };
  }
</script>

<div class="toast-container">
  {#each Object.values(notifications) as notif (notif.sessionID)}
    <div
      class="toast"
      class:exited={notif.type === "session_exited"}
      class:input={notif.type === "input_required"}
      role="alert"
      onmouseenter={() => handleMouseEnter(notif.sessionID)}
      onmouseleave={() => handleMouseLeave(notif.sessionID)}
    >
      <div class="toast-header">
        <span class="toast-icon">{notif.type === "session_exited" ? "⏹" : "⏳"}</span>
        <span class="toast-title">{notif.sessionName}</span>
      </div>
      <div class="toast-message">{notif.message}</div>
      <div class="toast-actions">
        <button class="toast-btn go" onclick={() => handleGoTo(notif.sessionID)}>Go to session</button>
        <button class="toast-btn dismiss" onclick={() => handleDismiss(notif.sessionID)}>Dismiss</button>
      </div>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }

  .toast {
    pointer-events: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 280px;
    max-width: 360px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideIn 0.2s ease-out;
  }

  .toast.input {
    border-color: var(--warning);
  }

  .toast.exited {
    border-color: var(--text-muted);
  }

  .toast-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .toast-icon {
    font-size: 14px;
  }

  .toast-title {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }

  .toast-message {
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .toast-actions {
    display: flex;
    gap: 8px;
  }

  .toast-btn {
    padding: 4px 10px;
    border: none;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .toast-btn.go {
    background: var(--accent);
    color: var(--bg-primary);
  }

  .toast-btn.go:hover {
    opacity: 0.9;
  }

  .toast-btn.dismiss {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
  }

  .toast-btn.dismiss:hover {
    color: var(--text-primary);
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
</style>
