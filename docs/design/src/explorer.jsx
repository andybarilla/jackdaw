/* global React */
// Workspace explorer — repos, worktrees, sessions (active + historical), artifacts
// NOT a kanban; a dense grouped list with filters.

const ExplorerScreen = ({ sessions, onSelect }) => {
  const [group, setGroup] = React.useState('repo');
  const groups = {};
  sessions.forEach(s => {
    const key = group === 'repo' ? s.repo
             : group === 'status' ? s.status
             : s.linkedArtifact ? s.linkedArtifact.title : 'Unlinked';
    (groups[key] = groups[key] || []).push(s);
  });

  return (
    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* header */}
      <div style={{
        padding:'18px 24px 14px', borderBottom:'1px solid var(--line)',
        display:'flex', alignItems:'flex-end', gap: 20, flexShrink: 0
      }}>
        <div style={{ flex:1 }}>
          <Label>Explorer</Label>
          <div style={{ fontSize: 26, color:'var(--fg-0)', fontWeight: 500, letterSpacing:'-0.025em', marginTop: 4 }}>
            Workspace content
          </div>
          <div style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)', marginTop: 4 }}>
            All sessions (active + historical), repos, worktrees, artifacts — flat and searchable.
          </div>
        </div>
        <Input icon={<Icon name="search" size={12}/>} placeholder="repo · branch · session id · file" full={false} />
        <div style={{ display:'flex', gap: 4 }}>
          {['repo','status','artifact'].map(k => (
            <button key={k} onClick={()=>setGroup(k)} className="btn-ghost" style={{
              background: group === k ? 'var(--bg-2)' : 'transparent',
              border:'1px solid var(--line)',
              padding:'6px 10px', cursor:'pointer',
              fontFamily:'var(--font-mono)', fontSize: 10, letterSpacing:'.06em',
              textTransform:'uppercase',
              color: group === k ? 'var(--fg-0)' : 'var(--fg-3)'
            }}>{k}</button>
          ))}
        </div>
      </div>

      {/* 3-column layout: list | artifacts | repo/worktree tree */}
      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'1fr 340px', overflow:'hidden' }}>
        {/* grouped session list */}
        <div style={{ overflow:'auto', padding:'8px 14px 20px', borderRight:'1px solid var(--line)' }}>
          {Object.entries(groups).map(([k, list]) => (
            <div key={k} style={{ marginTop: 14 }}>
              <div style={{
                display:'flex', alignItems:'center', gap: 10, padding:'6px 10px',
                borderBottom:'1px solid var(--line)', background:'var(--bg-0)'
              }}>
                <span style={{
                  fontFamily:'var(--font-mono)', fontSize: 10.5, letterSpacing:'.1em',
                  textTransform:'uppercase', color:'var(--fg-2)', fontWeight: 600
                }}>{k}</span>
                <span style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>· {list.length}</span>
              </div>
              <div style={{ border:'1px solid var(--line)', borderTop:0 }}>
                {/* table header */}
                <div style={{
                  display:'grid', gridTemplateColumns:'28px 110px 1fr 140px 110px 100px 90px',
                  padding:'6px 10px', borderBottom:'1px solid var(--line)',
                  fontFamily:'var(--font-mono)', fontSize: 9.5, letterSpacing:'.08em',
                  textTransform:'uppercase', color:'var(--fg-4)', background:'var(--bg-1)'
                }}>
                  <span></span>
                  <span>STATUS</span>
                  <span>NAME</span>
                  <span>BRANCH</span>
                  <span>PI · MODEL</span>
                  <span>CHANGES</span>
                  <span style={{ textAlign:'right' }}>UPDATED</span>
                </div>
                {list.map((s, i) => (
                  <div key={s.id} onClick={()=>onSelect(s.id)} className="hover-row-2" style={{
                    display:'grid', gridTemplateColumns:'28px 110px 1fr 140px 110px 100px 90px',
                    padding:'8px 10px',
                    borderBottom: i === list.length - 1 ? 'none' : '1px solid var(--line)',
                    cursor:'pointer', alignItems:'center',
                    fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-1)'
                  }}>
                    <StatusDot status={s.status} size={7}/>
                    <span style={{ color: STATUS[s.status].color, fontWeight: 500 }}>{STATUS[s.status].label}</span>
                    <span style={{ color:'var(--fg-0)', fontFamily:'var(--font-sans)', fontSize: 13, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</span>
                    <span style={{ color:'var(--fg-2)' }}>{s.branch}</span>
                    <span style={{ color:'var(--fg-3)' }}>{s.pi} · {s.model.split('-')[1] || s.model}</span>
                    <span style={{ color:'var(--fg-2)' }}>
                      {s.added ? <>+{s.added} <span style={{color:'var(--fg-4)'}}>−{s.removed}</span></> : <span style={{ color:'var(--fg-4)' }}>—</span>}
                    </span>
                    <span style={{ textAlign:'right', color:'var(--fg-3)' }}>{s.updated}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* right column: repos tree + artifacts */}
        <div style={{ overflow:'auto', padding:'14px 16px 20px', background:'var(--bg-0)' }}>
          <Label>Repos · worktrees</Label>
          <div style={{ marginTop: 10, border:'1px solid var(--line)', background:'var(--bg-1)' }}>
            {WORKSPACE.repos.map((r, i) => (
              <div key={r.id} style={{
                borderBottom: i === WORKSPACE.repos.length - 1 ? 'none' : '1px solid var(--line)'
              }}>
                <div style={{
                  padding:'8px 12px', display:'flex', alignItems:'center', gap: 10,
                  fontFamily:'var(--font-mono)', fontSize: 11
                }}>
                  <Icon name="git" size={12} color="var(--fg-3)"/>
                  <span style={{ color:'var(--fg-0)' }}>{r.name}</span>
                  <span style={{ marginLeft:'auto', color:'var(--fg-4)' }}>{r.worktrees} wt</span>
                </div>
                {/* worktrees */}
                {sessions.filter(s => s.repo === r.name).slice(0, 3).map(s => (
                  <div key={s.id} style={{
                    padding:'4px 12px 4px 30px', fontFamily:'var(--font-mono)', fontSize: 10.5,
                    display:'flex', alignItems:'center', gap: 8, color:'var(--fg-3)'
                  }}>
                    <Icon name="branch" size={10} color="var(--fg-4)"/>
                    <span>{s.worktree}</span>
                    <span style={{ marginLeft:'auto' }}>
                      <StatusDot status={s.status} size={5}/>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <Label style={{ marginTop: 20 }}>Artifacts</Label>
          <div style={{ marginTop: 10 }}>
            {ARTIFACTS.map(a => (
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
                <div style={{ fontSize: 12.5, color:'var(--fg-0)', marginTop: 6, letterSpacing:'-0.01em', fontWeight: 500 }}>
                  {a.title}
                </div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)', marginTop: 4, display:'flex', gap: 8 }}>
                  <span>{a.id}</span>
                  <span>·</span>
                  <span>@{a.author}</span>
                  {a.linked > 0 && <><span>·</span><span>linked {a.linked}</span></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ExplorerScreen });
