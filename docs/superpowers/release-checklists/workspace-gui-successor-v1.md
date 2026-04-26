# Workspace GUI Successor v1 Release Checklist

Use this checklist before calling the workspace GUI successor v1 complete.

## Automated verification

- [ ] `npm test -- src/service/orchestration/reconnect-manager.test.ts src/web/lib/api-client.test.ts`
- [ ] `npm test`
- [ ] `npm run check`
- [ ] `npm run build`
- [ ] `npm run package:dir`
- [ ] Confirm the packaged app directory exists under the Electron Builder output.

## Packaging

- [ ] Launch the packaged app from the generated directory, not only the Vite dev server.
- [ ] Confirm Electron starts a separate local service process.
- [ ] Confirm the renderer receives the service base URL through preload bootstrap state.
- [ ] Confirm the service listens only on loopback for v1.

## Restart and recovery

- [ ] Create a workspace with multiple repos and at least one worktree.
- [ ] Start multiple sessions in that workspace.
- [ ] Select a non-first session and confirm the selected session remains selected after restart when it still exists.
- [ ] Quit the app while at least one session is mid-run.
- [ ] Relaunch the packaged app.
- [ ] Confirm the workspace list is restored.
- [ ] Confirm session metadata is restored.
- [ ] Confirm reconnectable sessions return to `live`.
- [ ] Confirm unreconnectable sessions remain visible as `historical` / historical-only.
- [ ] Confirm no session disappears silently.
- [ ] Confirm historical-only sessions still show summary, repo/worktree context, recent files, linked artifacts, and the reconnect note.
- [ ] Confirm steer/follow-up/abort are disabled or reported as unavailable for historical-only sessions.

## Attention ordering

- [ ] Seed or create sessions in `awaiting-input`, `blocked`, `failed`, `running`, `idle`, and `done` states.
- [ ] Confirm sessions needing operator attention are ordered ahead of active and quiet sessions.
- [ ] Confirm restart recovery does not reorder already historical sessions solely because they were reloaded.
- [ ] Confirm changing activity on one live session does not make unrelated historical sessions jump unexpectedly.

## Session intervention

- [ ] Send a steer intervention to a live session.
- [ ] Send a follow-up intervention to a live session.
- [ ] Abort a live session.
- [ ] Confirm intervention state moves through accepted/pending/observed or failed states as appropriate.
- [ ] Confirm intervention failures remain legible in the command center.
- [ ] Confirm historical-only sessions return an explicit “historical and cannot be controlled” response.

## Workspace multi-repo handling

- [ ] Register at least two repo roots in one workspace.
- [ ] Register at least one worktree under a repo root.
- [ ] Start sessions from different repo/worktree contexts.
- [ ] Confirm each session shows the correct repo, worktree, cwd, and branch.
- [ ] Confirm linked plans/specs/artifacts are discoverable from the workspace context and selected session.
- [ ] Confirm removing a repo root does not erase historical session context that references it.

## HQ-optional behavior

- [ ] Launch without HQ environment variables or credentials.
- [ ] Confirm workspace, session, artifact, and intervention flows still work.
- [ ] Confirm settings show HQ as optional or unconfigured rather than blocking use.
- [ ] If HQ is configured, confirm related IDs/links appear as optional metadata only.

## Future remote boundary sanity

- [ ] Confirm the web API client uses the configured service base URL for HTTP requests.
- [ ] Confirm the SSE stream URL is derived from the configured service base URL.
- [ ] Confirm no renderer code calls service/runtime objects directly.
- [ ] Confirm v1 documentation and UI wording still describe loopback local service as the only supported mode.
