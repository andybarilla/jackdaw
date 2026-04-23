/* global React */
// Workspace home dashboard
// Three-column layout:
//  1) Attention rail — sessions ranked by urgency
//  2) Selected session command center (summary + act)
//  3) Workspace context panel — plans, artifacts, repos, history

// Helpers ------------------------------------------------------------------

const rankSession = (s) => {
  const order = { 'awaiting-input': 0, 'blocked': 1, 'failed': 2, 'running': 3, 'idle': 4, 'done': 5, 'historical': 6 };
  return order[s.status] ?? 99;
};

// Attention rail card ------------------------------------------------------
const AttentionCard = ({ session, active, onSelect }) => {
  const s = STATUS[session.status] || STATUS.running;
  const urgent = s.urgent;
  return (
    <div onClick={() => onSelect(session.id)} className="hover-border"
      style={{
        padding:'12px 14px 12px 12px',
        borderBottom:'1px solid var(--line)',
        borderLeft: `3px solid ${active ? 'var(--accent)' : (urgent ? s.color : 'transparent')}`,
        background: active ? 'var(--bg-2)' : 'transparent',
        cursor:'pointer', position:'relative'
      }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap: 8 }}>
        <StatusTag status={session.status} size="sm"/>
        <span style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>
          {session.updated} · {session.duration}
        </span>
      </div>
      <div style={{
        color:'var(--fg-0)', fontSize: 13.5, fontWeight: 500, letterSpacing:'-0.01em',
        marginTop: 8, lineHeight: 1.3
      }}>{session.name}</div>

      {/* REASON — the "why" — leading line for urgent sessions */}
      {session.reason && (
        <div style={{ marginTop: 6 }}>
          <ReasonChip status={session.status}>{session.reason}</ReasonChip>
        </div>
      )}

      {/* activity line */}
      {!session.reason && session.activity && (
        <div style={{
          fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-2)',
          marginTop: 6, lineHeight: 1.4,
          overflow:'hidden', textOverflow:'ellipsis', display:'-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient:'vertical'
        }}>
          {session.activity}
        </div>
      )}

      <div style={{
        display:'flex', alignItems:'center', gap: 8, marginTop: 10,
        fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-3)'
      }}>
        <Icon name="branch" size={11} color="var(--fg-4)"/>
        <span>{session.repo.split('/')[1]}:{session.branch.replace(/^feat\//,'')}</span>
        <span style={{ color:'var(--fg-4)' }}>·</span>
        <span>{session.pi}</span>
        {session.added > 0 && (
          <>
            <span style={{ color:'var(--fg-4)' }}>·</span>
            <span style={{ color:'var(--fg-2)' }}>+{session.added}</span>
            <span style={{ color:'var(--fg-4)' }}>−{session.removed}</span>
          </>
        )}
      </div>

      {/* recent files mini-snapshot */}
      {session.files && session.files.length > 0 && (
        <div style={{ marginTop: 8, display:'flex', gap: 4, flexWrap:'wrap' }}>
          {session.files.slice(0, 2).map(f => (
            <span key={f} style={{
              fontFamily:'var(--font-mono)', fontSize: 10,
              background:'var(--bg-2)', color:'var(--fg-2)', border:'1px solid var(--line)',
              padding:'1px 6px', maxWidth: 220,
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'
            }}>{f.split('/').slice(-1)[0]}</span>
          ))}
          {session.files.length > 2 && (
            <span style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>
              +{session.files.length - 2} more
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// Section header inside attention rail ------------------------------------
const RailSection = ({ label, count, tone }) => (
  <div style={{
    padding:'10px 14px 6px', display:'flex', alignItems:'center', gap: 8,
    borderBottom:'1px solid var(--line)', background:'var(--bg-0)'
  }}>
    <span style={{
      fontFamily:'var(--font-mono)', fontSize: 9.5, letterSpacing:'.12em',
      textTransform:'uppercase', color: tone || 'var(--fg-3)', fontWeight: 600
    }}>{label}</span>
    <span style={{
      fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)'
    }}>{count}</span>
  </div>
);

// Attention rail (col 1) --------------------------------------------------
const AttentionRail = ({ sessions, selectedId, onSelect, narrow }) => {
  const urgent  = sessions.filter(s => STATUS[s.status]?.urgent);
  const running = sessions.filter(s => s.status === 'running');
  const quiet   = sessions.filter(s => ['idle','done','historical'].includes(s.status));
  const [open, setOpen] = React.useState(true);

  if (narrow && !open) {
    return (
      <div style={{
        width: 44, flexShrink: 0, borderRight:'1px solid var(--line)',
        background:'var(--bg-0)', display:'flex', flexDirection:'column',
        alignItems:'center', padding:'10px 0', gap: 10
      }}>
        <button onClick={()=>setOpen(true)} style={{
          background:'var(--bg-2)', border:'1px solid var(--line)',
          width: 30, height: 30, cursor:'pointer', color:'var(--fg-2)',
          display:'inline-flex', alignItems:'center', justifyContent:'center'
        }}><Icon name="layers" size={13}/></button>
        {urgent.length > 0 && (
          <div title={`${urgent.length} urgent`} style={{
            width: 24, height: 24, background:'var(--warning)', color:'#0A0A0A',
            fontFamily:'var(--font-mono)', fontSize: 10, fontWeight: 700,
            display:'flex', alignItems:'center', justifyContent:'center'
          }}>{urgent.length}</div>
        )}
        <div style={{
          writingMode:'vertical-rl', transform:'rotate(180deg)',
          fontFamily:'var(--font-mono)', fontSize: 10, letterSpacing:'.12em',
          textTransform:'uppercase', color:'var(--fg-3)', marginTop: 8
        }}>{sessions.length} sessions</div>
      </div>
    );
  }

  return (
    <div style={{
      width: narrow ? 280 : 348, minWidth: narrow ? 260 : 300, flexShrink: 0,
      borderRight:'1px solid var(--line)', background:'var(--bg-0)',
      display:'flex', flexDirection:'column', minHeight: 0
    }}>
      {/* header */}
      <div style={{
        padding:'14px 14px 10px', borderBottom:'1px solid var(--line)',
        display:'flex', flexDirection:'column', gap: 10, flexShrink: 0
      }}>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
          <div>
            <Label>Attention</Label>
            <div style={{
              fontSize: 19, color:'var(--fg-0)', fontWeight: 500,
              letterSpacing:'-0.02em', marginTop: 2
            }}>Sessions <span style={{ color:'var(--fg-3)', fontWeight: 400, fontFamily:'var(--font-mono)', fontSize: 13 }}>· {sessions.length}</span></div>
          </div>
          <button className="btn-ghost" style={{
            background:'transparent', border:'1px solid var(--line)',
            padding:'4px 8px', fontFamily:'var(--font-mono)', fontSize: 10,
            color:'var(--fg-2)', letterSpacing:'.06em', cursor:'pointer',
            display:'inline-flex', alignItems:'center', gap: 6
          }}>
            URGENCY <Icon name="chevDown" size={10}/>
          </button>
        </div>
        <Input icon={<Icon name="search" size={12}/>} placeholder="filter · name, repo, branch" />
      </div>

      <div style={{ flex: 1, overflow:'auto', minHeight: 0 }}>
        {urgent.length > 0 && (
          <>
            <RailSection label="Needs you now" count={`${urgent.length}`} tone="var(--warning)"/>
            {urgent.sort((a,b)=>rankSession(a)-rankSession(b)).map(s => (
              <AttentionCard key={s.id} session={s} active={s.id===selectedId} onSelect={onSelect}/>
            ))}
          </>
        )}
        {running.length > 0 && (
          <>
            <RailSection label="Running" count={`${running.length}`} tone="var(--accent)"/>
            {running.map(s => (
              <AttentionCard key={s.id} session={s} active={s.id===selectedId} onSelect={onSelect}/>
            ))}
          </>
        )}
        {quiet.length > 0 && (
          <>
            <RailSection label="Quiet" count={`${quiet.length}`} tone="var(--fg-3)"/>
            {quiet.map(s => (
              <AttentionCard key={s.id} session={s} active={s.id===selectedId} onSelect={onSelect}/>
            ))}
          </>
        )}
      </div>

      {/* footer */}
      <div style={{
        padding:'10px 12px', borderTop:'1px solid var(--line)',
        display:'flex', alignItems:'center', justifyContent:'space-between', gap: 8,
        flexShrink: 0
      }}>
        <Button variant="ghost" size="sm" icon={<Icon name="plus" size={12}/>}>New session</Button>
        <span style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>
          <Kbd>⌘</Kbd> <Kbd>K</Kbd>
        </span>
      </div>
    </div>
  );
};

// Command center column (col 2) -------------------------------------------
const CommandCenter = ({ session, onIntervene, narrow }) => {
  const s = STATUS[session.status] || STATUS.running;
  const urgent = s.urgent;
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display:'flex', flexDirection:'column', background:'var(--bg-0)' }}>

      {/* HEADER strip — context + title + primary actions */}
      <div style={{
        padding:'14px 22px 14px', borderBottom:'1px solid var(--line)',
        display:'flex', alignItems:'flex-start', gap: 16, flexShrink: 0
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)',
            display:'flex', alignItems:'center', gap: 8, letterSpacing:'.02em'
          }}>
            <span>→ {session.id}</span>
            <span style={{ color:'var(--fg-4)' }}>·</span>
            <span>{session.repo}</span>
            <span style={{ color:'var(--fg-4)' }}>·</span>
            <span>{session.worktree}</span>
            <span style={{ color:'var(--fg-4)' }}>·</span>
            <span>{session.branch}</span>
          </div>
          <div style={{
            fontSize: 24, fontWeight: 500, letterSpacing:'-0.02em',
            color:'var(--fg-0)', margin:'6px 0 8px', lineHeight: 1.2
          }}>{session.name}</div>
          <div style={{ display:'flex', alignItems:'center', gap: 10, flexWrap:'wrap' }}>
            <StatusTag status={session.status}/>
            <Badge>{session.model}</Badge>
            <Badge tone="faint">{session.pi}</Badge>
            <span style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)' }}>
              {session.duration} · updated {session.updated}
            </span>
          </div>
        </div>

        {/* primary actions — ACT, STEER, ABORT are always present, equal-weighted with understanding */}
        <div style={{ display:'flex', gap: 6, flexShrink: 0 }}>
          <Button variant="ghost" size="sm" icon={<Icon name="eye" size={13}/>}>Observe</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="refresh" size={13}/>}>Refresh</Button>
          <Button variant="danger" size="sm" icon={<Icon name="stop" size={11}/>}>Abort</Button>
        </div>
      </div>

      {/* MAIN GRID — understanding on the left, intervention on the right, equal weight */}
      <div style={{
        flex: 1, minHeight: 0, display:'grid',
        gridTemplateColumns: narrow ? '1fr' : '1fr 360px', gap: 0
      }}>
        {/* UNDERSTAND side */}
        <div style={{ minHeight: 0, overflow:'auto', padding:'16px 22px 20px', borderRight:'1px solid var(--line)' }}>
          {/* URGENT banner */}
          {urgent && (
            <div style={{
              border:`1px solid ${s.color}`, padding:'12px 14px',
              background: s.color === 'var(--warning)' ? 'rgba(255,214,10,0.06)' : 'rgba(255,61,104,0.06)',
              display:'flex', alignItems:'flex-start', gap: 12, marginBottom: 16
            }}>
              <StatusDot status={session.status} size={10} ring/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily:'var(--font-sans)', fontWeight: 600, fontSize: 13,
                  color: s.color, letterSpacing:'-0.01em'
                }}>{s.label.toLowerCase() === 'awaiting input' ? 'Needs your answer' : s.label.toLowerCase() === 'blocked' ? 'Blocked — cannot proceed' : 'Agent exited with error'}</div>
                <div style={{ fontSize: 13, color:'var(--fg-1)', marginTop: 4, lineHeight: 1.45 }}>
                  {session.reason}
                </div>
                {session.status === 'awaiting-input' && (
                  <div style={{ display:'flex', gap: 6, marginTop: 10 }}>
                    <Button variant="primary" size="sm" icon={<Icon name="check" size={12}/>}>Approve</Button>
                    <Button variant="ghost" size="sm" icon={<Icon name="x" size={12}/>}>Decline</Button>
                    <Button variant="ghost" size="sm">Ask first</Button>
                  </div>
                )}
                {session.status === 'blocked' && (
                  <div style={{ display:'flex', gap: 6, marginTop: 10 }}>
                    <Button variant="primary" size="sm" icon={<Icon name="refresh" size={12}/>}>Retry connect</Button>
                    <Button variant="ghost" size="sm">Reassign pi</Button>
                    <Button variant="ghost" size="sm">View rook logs</Button>
                  </div>
                )}
                {session.status === 'failed' && (
                  <div style={{ display:'flex', gap: 6, marginTop: 10 }}>
                    <Button variant="primary" size="sm" icon={<Icon name="refresh" size={12}/>}>Restart</Button>
                    <Button variant="ghost" size="sm">Resume from last edit</Button>
                    <Button variant="ghost" size="sm">Open error</Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LIVE SUMMARY */}
          <Panel label="Live summary" meta={`streaming · ${session.updated}`} right={
            <Button variant="ghost" size="xs" icon={<Icon name="pin" size={11}/>}>Pin</Button>
          } style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, color:'var(--fg-1)', lineHeight: 1.55 }}>
              {session.live}
            </div>
            {session.status === 'running' && (
              <div style={{
                marginTop: 12, padding:'8px 10px', background:'var(--bg-2)',
                border:'1px solid var(--line)',
                display:'flex', alignItems:'center', gap: 10,
                fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-2)'
              }}>
                <StatusDot status="running" size={6}/>
                <span style={{ color:'var(--accent)' }}>currently</span>
                <span>{session.activity}</span>
              </div>
            )}
          </Panel>

          {/* PINNED SUMMARY — frozen snapshot, visually distinct */}
          <Panel
            label="Pinned summary"
            meta={session.pinned ? `frozen at ${session.pinnedAt}` : 'no pin yet'}
            right={session.pinned ? <Button variant="ghost" size="xs">Update pin</Button> : <Button variant="ghost" size="xs" icon={<Icon name="pin" size={11}/>}>Pin current</Button>}
            style={{ marginBottom: 14, background: session.pinned ? 'var(--bg-1)' : 'var(--bg-0)', borderStyle: session.pinned ? 'solid' : 'dashed' }}
          >
            {session.pinned ? (
              <div>
                <div style={{ fontSize: 13, color:'var(--fg-1)', lineHeight: 1.55, fontStyle:'normal' }}>
                  {session.pinned}
                </div>
                <div style={{
                  marginTop: 10, display:'flex', alignItems:'center', gap: 8,
                  fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)'
                }}>
                  <Icon name="pin" size={10} color="var(--fg-4)"/>
                  <span>FROZEN · does not drift with live activity · clear or replace manually</span>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color:'var(--fg-3)', lineHeight: 1.5 }}>
                Pin the live summary to freeze a reference point. Useful before stepping away, or before a risky intervention.
              </div>
            )}
          </Panel>

          {/* RECENT EVENTS */}
          <Panel label="Recent events" meta={`${session.events.length} in last ${session.duration}`}>
            <div style={{ fontFamily:'var(--font-mono)', fontSize: 11.5, lineHeight: 1.8 }}>
              {session.events.slice().reverse().map((e, i) => {
                const kindColor = e.kind === 'error' || e.kind === 'halt' ? 'var(--warning)'
                                : e.kind === 'edit' ? 'var(--accent)'
                                : e.kind === 'merge' ? 'var(--fg-0)'
                                : 'var(--fg-3)';
                return (
                  <div key={i} style={{ display:'flex', gap: 12, padding:'2px 0', alignItems:'baseline' }}>
                    <span style={{ color:'var(--fg-4)', width: 40 }}>{e.t}</span>
                    <span style={{
                      color: kindColor, width: 50, textTransform:'uppercase',
                      fontSize: 10, letterSpacing:'.06em'
                    }}>{e.kind}</span>
                    <span style={{ color:'var(--fg-1)', flex: 1 }}>{e.text}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* ACT side — intervention column. Equal weight to understanding. */}
        <div style={{ minHeight: 0, overflow:'auto', padding:'16px 18px 20px', background:'var(--bg-0)', borderTop: narrow ? '1px solid var(--line)' : 'none' }}>
          {/* STEER composer — the primary act */}
          <div style={{ border:'1px solid var(--line-hi)', background:'var(--bg-1)', marginBottom: 14 }}>
            <div style={{
              padding:'8px 12px', borderBottom:'1px solid var(--line)',
              display:'flex', alignItems:'center', gap: 8,
              fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'.1em',
              textTransform:'uppercase', color:'var(--fg-2)'
            }}>
              <Icon name="send" size={12} color="var(--accent)"/>
              Steer
              <span style={{ marginLeft:'auto', color:'var(--fg-4)' }}>interrupts current task</span>
            </div>
            <textarea
              placeholder="Redirect the agent. Current activity pauses until next turn."
              style={{
                width:'100%', minHeight: 68, padding:'10px 12px',
                background:'transparent', border: 0, outline: 0, resize:'vertical',
                color:'var(--fg-0)', fontFamily:'var(--font-sans)', fontSize: 13,
                lineHeight: 1.5
              }}
              defaultValue=""
            />
            <div style={{
              padding:'8px 10px', borderTop:'1px solid var(--line)',
              display:'flex', alignItems:'center', gap: 6
            }}>
              <Button variant="ghost" size="xs">Follow-up</Button>
              <span style={{ flex: 1 }}/>
              <Kbd>⌘⏎</Kbd>
              <Button variant="primary" size="sm" icon={<Icon name="send" size={12}/>}>Steer</Button>
            </div>
          </div>

          {/* Intervention lifecycle indicator */}
          <div style={{
            border:'1px solid var(--line)', padding:'10px 12px', marginBottom: 14,
            background:'var(--bg-1)'
          }}>
            <Label>Intervention lifecycle</Label>
            <div style={{ display:'flex', marginTop: 10, gap: 0 }}>
              {['accepted','pending','observed','failed'].map((k, i) => {
                const states = ['accepted','pending','observed','failed'];
                const active = i === 0;   // idle: nothing pending
                return (
                  <div key={k} style={{
                    flex: 1, padding:'6px 8px',
                    background: active ? 'var(--bg-2)' : 'transparent',
                    borderLeft: i === 0 ? '1px solid var(--line)' : '1px solid var(--line)',
                    borderRight: i === states.length - 1 ? '1px solid var(--line)' : 'none',
                    borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)',
                    textAlign:'center'
                  }}>
                    <div style={{
                      fontFamily:'var(--font-mono)', fontSize:9, letterSpacing:'.08em',
                      textTransform:'uppercase',
                      color: active ? 'var(--fg-0)' : 'var(--fg-4)'
                    }}>{k}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)', marginTop: 8 }}>
              No pending interventions. Last completed — 14:41 (pinned summary)
            </div>
          </div>

          {/* CONTEXT rollup */}
          <Label style={{ marginBottom: 8 }}>Context</Label>
          <KV rows={[
            ['Repo',      session.repo, 'var(--fg-1)'],
            ['Worktree',  session.worktree, 'var(--fg-1)'],
            ['Branch',    session.branch, 'var(--fg-1)'],
            ['Pi worker', session.pi, 'var(--fg-1)'],
            ['Model',     session.model, 'var(--fg-1)'],
            ['Changes',   `+${session.added} / −${session.removed}`, 'var(--fg-1)']
          ]}/>

          {/* Recent / changed files */}
          <div style={{ marginTop: 16 }}>
            <Label style={{ marginBottom: 8 }}>Recent files</Label>
            <div style={{
              fontFamily:'var(--font-mono)', fontSize: 11, lineHeight: 1.7,
              border:'1px solid var(--line)', background:'var(--bg-1)'
            }}>
              {session.files.map((f, i) => (
                <div key={f} className="hover-row-2" style={{
                  padding:'6px 10px',
                  borderBottom: i === session.files.length - 1 ? 'none' : '1px solid var(--line)',
                  display:'flex', alignItems:'center', gap: 8, color:'var(--fg-1)'
                }}>
                  <Icon name="file" size={11} color="var(--fg-4)"/>
                  <span style={{ flex: 1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f}</span>
                  <span style={{ color:'var(--fg-4)', fontSize: 10 }}>EDITED</span>
                </div>
              ))}
            </div>
          </div>

          {/* Linked artifact */}
          {session.linkedArtifact && (
            <div style={{ marginTop: 16 }}>
              <Label style={{ marginBottom: 8 }}>Linked artifact</Label>
              <div className="hover-row-2" style={{
                padding:'10px 12px', border:'1px solid var(--line)', background:'var(--bg-1)',
                display:'flex', alignItems:'center', gap: 10, cursor:'pointer'
              }}>
                <Icon name="doc" size={14} color="var(--fg-3)"/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color:'var(--fg-0)', fontWeight: 500, letterSpacing:'-0.01em' }}>
                    {session.linkedArtifact.title}
                  </div>
                  <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)', marginTop: 2, letterSpacing:'.04em' }}>
                    {session.linkedArtifact.kind.toUpperCase()} · {session.linkedArtifact.id}
                  </div>
                </div>
                <Icon name="open" size={12} color="var(--fg-3)"/>
              </div>
            </div>
          )}

          {/* Secondary actions — all equal-weighted */}
          <div style={{ marginTop: 18, display:'flex', flexDirection:'column', gap: 6 }}>
            <Button variant="ghost" size="sm" full icon={<Icon name="open" size={12}/>}>Open repo / worktree</Button>
            <Button variant="ghost" size="sm" full icon={<Icon name="file" size={12}/>}>Diff vs. main</Button>
            <Button variant="ghost" size="sm" full icon={<Icon name="term" size={12}/>}>Shell fallback</Button>
          </div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)', marginTop: 6, lineHeight: 1.5 }}>
            Shell is the escape hatch. Prefer steer + follow-up for routine work.
          </div>
        </div>
      </div>
    </div>
  );
};

// Context panel (col 3) --------------------------------------------------
const WorkspaceContext = ({ sessions }) => {
  const historical = sessions.filter(s => s.status === 'historical' || s.status === 'done');
  return (
    <div style={{
      width: 320, minWidth: 280, flexShrink: 0,
      borderLeft:'1px solid var(--line)', background:'var(--bg-0)',
      display:'flex', flexDirection:'column', minHeight: 0, overflow:'auto'
    }}>
      <div style={{
        padding:'14px 14px 10px', borderBottom:'1px solid var(--line)',
        display:'flex', flexDirection:'column', gap: 2
      }}>
        <Label>Workspace context</Label>
        <div style={{ fontSize: 17, color:'var(--fg-0)', fontWeight: 500, letterSpacing:'-0.02em' }}>
          platform-auth
        </div>
        <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)', marginTop: 2 }}>
          ~/work/platform-auth
        </div>
      </div>

      {/* Linked plans / specs */}
      <div style={{ padding:'14px 14px 6px' }}>
        <Label>Plans & specs <span style={{ color:'var(--fg-4)' }}>· 3</span></Label>
      </div>
      <div style={{ padding:'0 10px 10px' }}>
        {ARTIFACTS.filter(a => ['plan','spec'].includes(a.kind)).map(a => (
          <div key={a.id} className="hover-row-2" style={{
            padding:'8px 10px', border:'1px solid var(--line)', background:'var(--bg-1)',
            marginBottom: 6, cursor:'pointer'
          }}>
            <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
              <Badge tone={a.kind === 'plan' ? 'accent' : 'default'}>{a.kind}</Badge>
              <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>
                {a.updated}
              </span>
            </div>
            <div style={{ fontSize: 13, color:'var(--fg-0)', marginTop: 6, letterSpacing:'-0.01em', fontWeight: 500, lineHeight: 1.3 }}>
              {a.title}
            </div>
            {a.linked > 0 && (
              <div style={{ marginTop: 6, fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-3)', display:'flex', alignItems:'center', gap: 6 }}>
                <Icon name="link" size={10}/> linked to {a.linked} session{a.linked>1?'s':''}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Repos / worktrees at-a-glance */}
      <div style={{ padding:'10px 14px 6px', borderTop:'1px solid var(--line)' }}>
        <Label>Repos · worktrees</Label>
      </div>
      <div style={{ padding:'0 14px 14px', fontFamily:'var(--font-mono)', fontSize: 11 }}>
        {WORKSPACE.repos.map(r => (
          <div key={r.id} className="hover-row" style={{
            padding:'5px 0', display:'flex', alignItems:'center', gap: 10,
            borderBottom: '1px solid var(--line)'
          }}>
            <Icon name="git" size={11} color="var(--fg-4)"/>
            <span style={{ color:'var(--fg-1)' }}>{r.name}</span>
            <span style={{ marginLeft:'auto', color:'var(--fg-4)' }}>{r.worktrees} wt</span>
          </div>
        ))}
      </div>

      {/* Historical sessions — stay visible even if reconnect failed */}
      <div style={{ padding:'10px 14px 6px', borderTop:'1px solid var(--line)' }}>
        <Label>Historical <span style={{ color:'var(--fg-4)' }}>· {historical.length}</span></Label>
      </div>
      <div style={{ padding:'0 14px 16px' }}>
        {historical.map(s => (
          <div key={s.id} className="hover-row-2" style={{
            padding:'8px 10px', border:'1px solid var(--line)',
            marginBottom: 6, cursor:'pointer', background:'var(--bg-0)'
          }}>
            <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
              <StatusTag status={s.status} size="sm"/>
              <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>
                {s.updated}
              </span>
            </div>
            <div style={{ fontSize: 12, color:'var(--fg-1)', marginTop: 6, lineHeight: 1.3 }}>
              {s.name}
            </div>
            <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)', marginTop: 4 }}>
              → {s.repo.split('/')[1]} · {s.branch}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Home screen entry -------------------------------------------------------
const HomeScreen = ({ sessions, selectedId, onSelect }) => {
  const selected = sessions.find(s => s.id === selectedId) || sessions[0];
  const vw = useViewportWidth();
  const [ctxOpen, setCtxOpen] = useState(false);
  const narrowCC = vw < 1024;
  const narrowRail = vw < 900;

  return (
      <div style={{ flex: 1, minHeight: 0, display:'flex', position:'relative' }}>
      {vw >= 1280 ? (
        <>
          <AttentionRail sessions={sessions} selectedId={selectedId} onSelect={onSelect} narrow={narrowRail}/>
          <CommandCenter session={selected} narrow={narrowCC}/>
          <WorkspaceContext sessions={sessions}/>
        </>
      ) : (
        <>
          <AttentionRail sessions={sessions} selectedId={selectedId} onSelect={onSelect} narrow={narrowRail}/>
          <CommandCenter session={selected} narrow={narrowCC}/>
          <button onClick={()=>setCtxOpen(true)} style={{
            position:'absolute', top: 12, right: 12, zIndex: 50,
            background:'var(--bg-1)', border:'1px solid var(--line-hi)',
            padding:'6px 10px', cursor:'pointer',
            fontFamily:'var(--font-mono)', fontSize: 10, letterSpacing:'.08em',
            textTransform:'uppercase', color:'var(--fg-1)',
            display:'inline-flex', alignItems:'center', gap: 6
          }}>
            <Icon name="layers" size={11}/> Context
          </button>
          {ctxOpen && (
            <>
              <div onClick={()=>setCtxOpen(false)} style={{
                position:'absolute', inset:0, background:'rgba(0,0,0,0.5)', zIndex: 60
              }}/>
              <div style={{
                position:'absolute', top:0, right:0, bottom:0, width: 320,
                zIndex: 61, borderLeft:'1px solid var(--line-hi)',
                boxShadow:'-12px 0 24px rgba(0,0,0,0.3)'
              }}>
                <WorkspaceContext sessions={sessions}/>
              </div>
            </>
          )}
        </>
      )}
      </div>
  );
};

Object.assign(window, {
  AttentionRail, AttentionCard, CommandCenter, WorkspaceContext, HomeScreen, rankSession
});
