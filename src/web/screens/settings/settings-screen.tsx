import React from "react";
import type { IntegrationSettingsDto } from "../../../shared/transport/dto.js";
import type { ApiClient } from "../../lib/api-client.js";

export interface SettingsScreenProps {
  apiClient: ApiClient;
  onBackToSessions: () => void;
}

type SettingsLoadable =
  | { status: "loading" }
  | { status: "ready"; settings: IntegrationSettingsDto }
  | { status: "error"; message: string };

export function SettingsScreen({ apiClient, onBackToSessions }: SettingsScreenProps): React.JSX.Element {
  const [settings, setSettings] = React.useState<SettingsLoadable>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    void apiClient.getIntegrationSettings()
      .then((nextSettings) => {
        if (!cancelled) {
          setSettings({ status: "ready", settings: nextSettings });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSettings({ status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiClient]);

  const hqContent = settings.status === "ready"
    ? (
        <div>
          <p>Status: <strong>{settings.settings.hq.status === "configured" ? "configured" : "not configured"}</strong></p>
          <p className="muted">HQ is optional and disabled for normal local app use.</p>
          {settings.settings.hq.linkedIds.projectId !== undefined && <p>Project: {settings.settings.hq.linkedIds.projectId}</p>}
          {settings.settings.hq.linkedIds.workItemIds.length > 0 && <p>Work items: {settings.settings.hq.linkedIds.workItemIds.join(", ")}</p>}
          {settings.settings.hq.linkedIds.sessionIds.length > 0 && <p>Sessions: {settings.settings.hq.linkedIds.sessionIds.join(", ")}</p>}
        </div>
      )
    : settings.status === "error"
      ? <p role="alert">{settings.message}</p>
      : <p>Loading settings…</p>;

  return (
    <div className="settings-screen" data-route="settings-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Optional integrations</h2>
        </div>
        <button type="button" className="secondary-button" onClick={onBackToSessions}>Back to sessions</button>
      </header>
      <section className="panel">
        <h3>HQ integration</h3>
        {hqContent}
      </section>
    </div>
  );
}
