import React from "react";
import type { HealthResponse, RendererBootstrap } from "../shared/transport/api.js";

declare global {
  interface Window {
    jackdaw?: {
      bootstrap: RendererBootstrap;
    };
  }
}

type HealthState =
  | { status: "loading" }
  | { status: "ready"; data: HealthResponse }
  | { status: "error"; message: string };

const bootstrap = window.jackdaw?.bootstrap ?? {
  serviceBaseUrl: "http://127.0.0.1:7345",
  appDataDir: "",
  platform: navigator.platform.toLowerCase().includes("mac") ? "darwin" : "linux",
};

const placeholderSessions = [
  {
    id: "ses-foundation-1",
    name: "Milestone 1 scaffold",
    status: "running",
    repo: "jackdaw",
    branch: "main",
    summary: "Booting desktop shell, local service, and web UI.",
  },
  {
    id: "ses-foundation-2",
    name: "Design system ingestion",
    status: "idle",
    repo: "jackdaw",
    branch: "main",
    summary: "Preparing Claude Design artifacts for React translation.",
  },
];

export function App(): React.JSX.Element {
  const [health, setHealth] = React.useState<HealthState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`${bootstrap.serviceBaseUrl}/health`);
        if (!response.ok) {
          throw new Error(`Health check failed with ${response.status}`);
        }
        const data = (await response.json()) as HealthResponse;
        if (!cancelled) {
          setHealth({ status: "ready", data });
        }
      } catch (error) {
        if (!cancelled) {
          setHealth({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Jackdaw</p>
          <h1>Operator Workbench</h1>
        </div>
        <div className="topbar-meta">
          <span>{bootstrap.platform}</span>
          <span>{bootstrap.serviceBaseUrl}</span>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel">
          <div className="panel-header">
            <p className="eyebrow">Service health</p>
            <span className={`status-pill status-${health.status}`}>{health.status}</span>
          </div>
          <div className="health-card">
            {health.status === "loading" && <p>Checking local orchestration service…</p>}
            {health.status === "error" && <p>Service unavailable: {health.message}</p>}
            {health.status === "ready" && (
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{health.data.ok ? "Healthy" : "Unhealthy"}</dd>
                </div>
                <div>
                  <dt>Service</dt>
                  <dd>{health.data.service}</dd>
                </div>
                <div>
                  <dt>App data</dt>
                  <dd>{health.data.appDataDir}</dd>
                </div>
                <div>
                  <dt>Checked at</dt>
                  <dd>{new Date(health.data.timestamp).toLocaleString()}</dd>
                </div>
              </dl>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <p className="eyebrow">Workspace</p>
            <button className="ghost-button">platform-auth</button>
          </div>
          <div className="placeholder-copy">
            <h2>GUI foundation is live</h2>
            <p>
              This placeholder shell proves the target architecture: Electron desktop shell, loopback service,
              and React renderer running separately from the pi-native prototype.
            </p>
          </div>
        </section>

        <section className="panel attention-panel">
          <div className="panel-header">
            <p className="eyebrow">Placeholder attention rail</p>
            <span className="muted">2 sessions</span>
          </div>
          <ul className="session-list">
            {placeholderSessions.map((session) => (
              <li key={session.id} className="session-card">
                <div className="session-card-header">
                  <strong>{session.name}</strong>
                  <span className={`status-pill status-${session.status}`}>{session.status}</span>
                </div>
                <p>{session.summary}</p>
                <small>
                  {session.repo} · {session.branch}
                </small>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
