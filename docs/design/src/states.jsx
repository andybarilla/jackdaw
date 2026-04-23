/* global React */
// Key states:
// - no-workspace, no-sessions
// - awaiting-input, blocked, historical-only (session detail variants)
// - intervention: pending / observed / failed

// Generic empty frame ------------------------------------------------------
const EmptyFrame = ({ glyph = '○', title, sub, actions, footer }) => (
  <div style={{ flex:1, minHeight:0, display:'flex', alignItems:'center', justifyContent:'center', padding: 40 }}>
    <div style={{ maxWidth: 560, textAlign:'left' }}>
      <div style={{
        border:'1px solid var(--line)', padding:'44px 42px', background:'var(--bg-1)'
      }}>
        <div style={{
          fontFamily:'var(--font-mono)', fontSize: 48, lineHeight: 1,
          color:'var(--accent)', marginBottom: 24
        }}>{glyph}</div>
        <div style={{
          fontSize: 28, fontWeight: 500, letterSpacing:'-0.025em',
          color:'var(--fg-0)', marginBottom: 12, lineHeight: 1.15
        }}>{title}</div>
        <div style={{
          fontSize: 14, color:'var(--fg-2)', lineHeight: 1.6, marginBottom: 24,
          maxWidth: 460
        }}>{sub}</div>
        <div style={{ display:'flex', gap: 8, flexWrap:'wrap' }}>{actions}</div>
        {footer && (
          <div style={{
            marginTop: 26, paddingTop: 16, borderTop:'1px solid var(--line)',
            fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-4)', lineHeight: 1.6
          }}>{footer}</div>
        )}
      </div>
    </div>
  </div>
);

// No workspace (first-run) ------------------------------------------------
const StateNoWorkspace = () => (
  <EmptyFrame
    glyph="◇"
    title="No workspace open"
    sub="A workspace is how Jackdaw groups your repos, worktrees, and sessions. Point it at a folder on disk — we'll discover repos automatically."
    actions={<>
      <Button variant="primary" size="md" icon={<Icon name="folder" size={13}/>}>Open folder…</Button>
      <Button variant="ghost" size="md" icon={<Icon name="plus" size={13}/>}>New workspace</Button>
      <Button variant="ghost" size="md">Clone from Git…</Button>
    </>}
    footer={
      <>
        <div>Recent</div>
        <div style={{ marginTop: 8, display:'flex', flexDirection:'column', gap: 4 }}>
          <span style={{ color:'var(--fg-2)' }}>→ ~/work/platform-auth</span>
          <span style={{ color:'var(--fg-2)' }}>→ ~/work/rook</span>
          <span style={{ color:'var(--fg-2)' }}>→ ~/Sandbox/scratch</span>
        </div>
      </>
    }
  />
);

// No sessions (workspace open but empty) ----------------------------------
const StateNoSessions = () => (
  <div style={{ flex:1, minHeight:0, display:'flex' }}>
    {/* empty rail for rhythm */}
    <div style={{
      width: 348, borderRight:'1px solid var(--line)', background:'var(--bg-0)',
      padding:'14px', display:'flex', flexDirection:'column', gap: 12
    }}>
      <Label>Attention</Label>
      <div style={{ fontSize: 19, color:'var(--fg-0)', fontWeight: 500, letterSpacing:'-0.02em' }}>
        Sessions <span style={{ color:'var(--fg-3)', fontWeight: 400, fontFamily:'var(--font-mono)', fontSize: 13 }}>· 0</span>
      </div>
      <div style={{
        border:'1px dashed var(--line)', padding: 20, textAlign:'center',
        color:'var(--fg-4)', fontFamily:'var(--font-mono)', fontSize: 11,
        letterSpacing:'.04em', textTransform:'uppercase', marginTop: 12
      }}>No sessions in this workspace</div>
    </div>
    <EmptyFrame
      glyph="●"
      title="No sessions yet"
      sub="Launch a Pi session against one of your worktrees, or import a running session from a running Rook container. Sessions are the main attention object — you'll spend almost all your time here."
      actions={<>
        <Button variant="primary" size="md" icon={<Icon name="play" size={12}/>}>Launch session</Button>
        <Button variant="ghost" size="md">Import from Rook</Button>
        <Button variant="ghost" size="md">From artifact…</Button>
      </>}
      footer={
        <>
          <div>Picked up from workspace</div>
          <div style={{ marginTop: 8, display:'flex', flexWrap:'wrap', gap: 6 }}>
            {WORKSPACE.repos.map(r => (
              <span key={r.id} style={{
                border:'1px solid var(--line)', padding:'3px 8px',
                fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-2)'
              }}>{r.name}</span>
            ))}
          </div>
        </>
      }
    />
  </div>
);

// Awaiting-input session (wireframe focused on that single state) ---------
const StateAwaiting = ({ sessions, onSelect }) => {
  const s = sessions.find(x => x.status === 'awaiting-input');
  return <HomeScreen sessions={sessions} selectedId={s.id} onSelect={onSelect}/>;
};

// Blocked session ---------------------------------------------------------
const StateBlocked = ({ sessions, onSelect }) => {
  const s = sessions.find(x => x.status === 'blocked');
  return <HomeScreen sessions={sessions} selectedId={s.id} onSelect={onSelect}/>;
};

// Historical-only (session that can't reconnect) -------------------------
const StateHistoricalOnly = ({ sessions, onSelect }) => {
  const s = sessions.find(x => x.status === 'historical');
  return (
    <div style={{ flex:1, minHeight:0, display:'flex' }}>
      <AttentionRail sessions={sessions} selectedId={s.id} onSelect={onSelect}/>
      <div style={{ flex:1, minWidth: 520, display:'flex', flexDirection:'column', background:'var(--bg-0)' }}>
        <div style={{
          padding:'14px 22px', borderBottom:'1px solid var(--line)',
          display:'flex', alignItems:'flex-start', gap: 16
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)' }}>
              → {s.id} · {s.repo} · {s.branch}
            </div>
            <div style={{ fontSize: 24, fontWeight: 500, letterSpacing:'-0.02em', color:'var(--fg-0)', margin:'6px 0 8px' }}>{s.name}</div>
            <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
              <StatusTag status="historical"/>
              <span style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)' }}>
                last contact {s.updated} · pi-7 unreachable
              </span>
            </div>
          </div>
          <div style={{ display:'flex', gap: 6 }}>
            <Button variant="ghost" size="sm" icon={<Icon name="refresh" size={12}/>}>Retry reconnect</Button>
            <Button variant="ghost" size="sm">Archive</Button>
          </div>
        </div>

        <div style={{ padding:'22px 22px 28px', flex:1, overflow:'auto' }}>
          <div style={{
            border:'1px solid var(--fg-4)', padding:'14px 16px',
            background:'var(--bg-1)', marginBottom: 20,
            display:'flex', alignItems:'flex-start', gap: 12
          }}>
            <Icon name="history" size={16} color="var(--fg-3)"/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize: 14, color:'var(--fg-0)', fontWeight: 500, letterSpacing:'-0.01em' }}>
                This session is read-only.
              </div>
              <div style={{ fontSize: 13, color:'var(--fg-2)', marginTop: 4, lineHeight: 1.55 }}>
                Heartbeat to <span className="t-code">pi-7</span> lost 3h ago. The last live summary, changed files, and event log are preserved and browsable. Retry reconnect to resume, or archive to hide from the rail.
              </div>
            </div>
          </div>

          <Panel label="Last live summary · frozen" meta={`captured ${s.updated}`} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, color:'var(--fg-1)', lineHeight: 1.55 }}>
              {s.live}
            </div>
          </Panel>
          <Panel label="Final event log" meta={`${s.events.length} events`}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize: 11.5, lineHeight: 1.8 }}>
              {s.events.slice().reverse().map((e, i) => (
                <div key={i} style={{ display:'flex', gap: 12, padding:'2px 0', alignItems:'baseline' }}>
                  <span style={{ color:'var(--fg-4)', width: 40 }}>{e.t}</span>
                  <span style={{ color:'var(--fg-3)', width: 50, textTransform:'uppercase', fontSize: 10, letterSpacing:'.06em' }}>{e.kind}</span>
                  <span style={{ color:'var(--fg-1)', flex: 1 }}>{e.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
};

// Intervention lifecycle demo — one component, three phases --------------
const InterventionDemo = ({ phase }) => {
  // phase ∈ {'pending', 'observed', 'failed'}
  const steps = [
    { k:'accepted', label:'ACCEPTED',    sub:'received locally',        tMs: '14:44:02' },
    { k:'pending',  label:'PENDING',     sub:'waiting for next turn',   tMs: '14:44:03' },
    { k:'observed', label:'OBSERVED',    sub:'agent acknowledged',      tMs: '14:44:07' },
    { k:'failed',   label:'FAILED',      sub:'agent went its own way',  tMs: '14:44:12' }
  ];
  const reachedIndex = phase === 'pending'  ? 1
                     : phase === 'observed' ? 2
                     : /* failed */          3;

  // The intervention itself
  const intervention = {
    sent: '14:44:01',
    from: 'EK',
    text: 'Skip the legacy verifier deletion. Keep it flagged deprecated for now.',
    agent: 'ses-0f3a'
  };

  const s = sessions => sessions; // no-op

  const sess = SESSIONS.find(x => x.id === intervention.agent);

  return (
    <div style={{ flex:1, minHeight:0, display:'flex' }}>
      <AttentionRail sessions={SESSIONS} selectedId={sess.id} onSelect={()=>{}}/>
      <div style={{ flex:1, minWidth: 520, display:'flex', flexDirection:'column', background:'var(--bg-0)', overflow:'auto' }}>
        <div style={{
          padding:'14px 22px', borderBottom:'1px solid var(--line)',
          display:'flex', alignItems:'flex-start', gap: 16
        }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)' }}>
              → {sess.id} · {sess.repo} · {sess.branch}
            </div>
            <div style={{ fontSize: 24, fontWeight: 500, letterSpacing:'-0.02em', color:'var(--fg-0)', margin:'6px 0 8px' }}>
              {sess.name}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
              <StatusTag status={sess.status}/>
              <span style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)' }}>
                intervention sent at {intervention.sent}
              </span>
            </div>
          </div>
        </div>

        <div style={{ padding:'22px 22px 30px' }}>
          {/* The intervention card */}
          <div style={{
            border:`1px solid ${phase === 'failed' ? 'var(--danger)' : 'var(--line-hi)'}`,
            background:'var(--bg-1)', marginBottom: 20
          }}>
            <div style={{
              padding:'10px 14px', borderBottom:'1px solid var(--line)',
              display:'flex', alignItems:'center', gap: 10,
              background:'var(--bg-1)'
            }}>
              <Icon name="send" size={12} color="var(--accent)"/>
              <span style={{ fontFamily:'var(--font-mono)', fontSize: 10, letterSpacing:'.1em', textTransform:'uppercase', color:'var(--fg-2)' }}>
                Steer · intervention
              </span>
              <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>
                from @{intervention.from} · {intervention.sent}
              </span>
            </div>
            <div style={{ padding:'14px 16px' }}>
              <div style={{ fontSize: 14, color:'var(--fg-0)', lineHeight: 1.55 }}>
                {intervention.text}
              </div>
            </div>

            {/* Lifecycle tracker */}
            <div style={{ padding:'0 16px 16px' }}>
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(4, 1fr)',
                border:'1px solid var(--line)'
              }}>
                {steps.map((st, i) => {
                  const reached = i <= reachedIndex;
                  const active  = i === reachedIndex;
                  const failed  = phase === 'failed' && i === 3;
                  const observedSuccess = phase === 'observed' && i === 2;
                  const color = failed ? 'var(--danger)'
                              : observedSuccess ? 'var(--accent)'
                              : active ? (phase === 'pending' ? 'var(--warning)' : 'var(--fg-0)')
                              : reached ? 'var(--fg-2)' : 'var(--fg-4)';
                  const bg    = (active || failed || observedSuccess) ? 'var(--bg-2)' : 'var(--bg-1)';
                  const glyph = failed ? '✕'
                              : observedSuccess ? '✓'
                              : active && phase === 'pending' ? '◔'
                              : reached ? '●' : '○';
                  return (
                    <div key={st.k} style={{
                      padding:'10px 12px', background: bg,
                      borderRight: i < 3 ? '1px solid var(--line)' : 'none',
                      borderTop: active ? `2px solid ${color}` : '2px solid transparent',
                      marginTop: active ? -1 : 0
                    }}>
                      <div style={{
                        display:'flex', alignItems:'center', gap: 6,
                        fontFamily:'var(--font-mono)', fontSize: 10.5, letterSpacing:'.06em',
                        color
                      }}>
                        <span style={{ fontSize: 11 }}>{glyph}</span>
                        <span style={{ fontWeight: 600 }}>{st.label}</span>
                      </div>
                      <div style={{
                        fontFamily:'var(--font-sans)', fontSize: 11,
                        color: active ? 'var(--fg-1)' : 'var(--fg-4)', marginTop: 4,
                        lineHeight: 1.3
                      }}>{st.sub}</div>
                      <div style={{
                        fontFamily:'var(--font-mono)', fontSize: 10,
                        color: reached ? 'var(--fg-3)' : 'var(--fg-4)', marginTop: 4
                      }}>{reached ? st.tMs : '—'}</div>
                    </div>
                  );
                })}
              </div>
              {phase === 'pending' && (
                <div style={{
                  marginTop: 12, padding:'8px 10px', background:'var(--bg-2)',
                  border:'1px solid var(--warning)',
                  fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--warning)',
                  display:'flex', alignItems:'center', gap: 10
                }}>
                  <span>◔</span>
                  <span>WAITING · agent is mid-tool-call, will pick up intervention at next turn.</span>
                  <span style={{ marginLeft:'auto', color:'var(--fg-3)' }}>~ 4s typical</span>
                </div>
              )}
              {phase === 'observed' && (
                <div style={{
                  marginTop: 12, padding:'10px 12px', background:'var(--bg-2)',
                  border:'1px solid var(--accent)',
                  display:'flex', alignItems:'flex-start', gap: 10
                }}>
                  <span style={{ color:'var(--accent)' }}>✓</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--accent)' }}>
                      OBSERVED · agent acknowledged at 14:44:07
                    </div>
                    <div style={{ fontSize: 13, color:'var(--fg-1)', marginTop: 6, lineHeight: 1.5 }}>
                      Agent: "Understood — keeping <span className="t-code">legacy-verifier.ts</span> in place, adding <span className="t-code">@deprecated</span> JSDoc and filing a cleanup ticket."
                    </div>
                  </div>
                </div>
              )}
              {phase === 'failed' && (
                <div style={{
                  marginTop: 12, padding:'10px 12px', background:'var(--bg-2)',
                  border:'1px solid var(--danger)',
                  display:'flex', alignItems:'flex-start', gap: 10
                }}>
                  <span style={{ color:'var(--danger)' }}>✕</span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--danger)' }}>
                      FAILED · agent proceeded without respecting steer
                    </div>
                    <div style={{ fontSize: 13, color:'var(--fg-1)', marginTop: 6, lineHeight: 1.5 }}>
                      The next two edits still touched <span className="t-code">legacy-verifier.ts</span>. Your intervention did not take. Consider aborting and relaunching with the constraint baked into the prompt.
                    </div>
                    <div style={{ display:'flex', gap: 6, marginTop: 10 }}>
                      <Button variant="danger" size="sm">Abort session</Button>
                      <Button variant="ghost" size="sm">Re-send with stronger wording</Button>
                      <Button variant="ghost" size="sm">Shell fallback</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <Panel label="Live summary" meta="streaming">
            <div style={{ fontSize: 13.5, color:'var(--fg-1)', lineHeight: 1.55 }}>
              {phase === 'failed'
                ? 'Agent continued its planned deletion despite steer. 2 further edits landed on legacy-verifier.ts before the user aborted.'
                : phase === 'observed'
                ? 'Agent acknowledged steer. Adding @deprecated to legacy-verifier.ts and filing a cleanup ticket. Tests re-running.'
                : sess.live}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  StateNoWorkspace, StateNoSessions, StateAwaiting, StateBlocked,
  StateHistoricalOnly, InterventionDemo
});
