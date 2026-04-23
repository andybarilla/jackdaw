/* global React */
// Outer shell: top chrome + left rail for screen navigation + status bar.
// This is the "workbench chrome" around every screen.

const Shell = ({ screen, setScreen, scenario, setScenario, children }) => {
  const vw = useViewportWidth();
  const compact = vw < 1024;
  const [railOpen, setRailOpen] = React.useState(!compact);
  React.useEffect(() => { setRailOpen(!compact); }, [compact]);
  const screens = [
    { k:'home',     label:'Home',     icon:'layers',   sub:'Workspace dashboard' },
    { k:'session',  label:'Session',  icon:'compass',  sub:'Command center' },
    { k:'explorer', label:'Explorer', icon:'folder',   sub:'Repos, worktrees, history' },
    { k:'artifact', label:'Artifact', icon:'doc',      sub:'Plans, specs, memos' },
    { k:'settings', label:'Settings', icon:'gear',     sub:'Connections & prefs' }
  ];
  const stateScreens = [
    { k:'state-no-workspace', label:'No workspace' },
    { k:'state-no-sessions',  label:'No sessions' },
    { k:'state-awaiting',     label:'Awaiting-input' },
    { k:'state-blocked',      label:'Blocked' },
    { k:'state-historical',   label:'Historical-only' },
    { k:'state-int-pending',  label:'Intervention · pending' },
    { k:'state-int-observed', label:'Intervention · observed' },
    { k:'state-int-failed',   label:'Intervention · failed' }
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'var(--bg-0)' }}>
      {/* Top chrome — thin */}
      <div style={{
        height: 44, borderBottom:'1px solid var(--line)', display:'flex', alignItems:'center',
        padding:'0 14px', gap: 14, flexShrink: 0, background:'var(--bg-0)'
      }}>
        <button onClick={()=>setRailOpen(v=>!v)} style={{
          background:'transparent', border:'1px solid var(--line)',
          width: 28, height: 28, display:'inline-flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', color:'var(--fg-2)', flexShrink: 0
        }}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
          <svg viewBox="0 0 36 28" width="20" height="16" fill="none">
            <path d="M4 14 L18 4 L32 14" stroke="#FF4D00" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square"/>
            <path d="M4 24 L18 14 L32 24" stroke="#FAFAF7" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="square" opacity="0.55"/>
          </svg>
          <span style={{ fontSize: 14, fontWeight: 600, color:'var(--fg-0)', letterSpacing:'-0.02em' }}>Jackdaw</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>0.5.0</span>
        </div>
        <Divider v style={{ height: 22, margin:'0 6px' }}/>
        {/* workspace switcher */}
        <button className="btn-ghost" style={{
          display:'inline-flex', alignItems:'center', gap: 8,
          background:'transparent', border:'1px solid var(--line)',
          padding:'4px 10px', cursor:'pointer',
          fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-1)'
        }}>
          <Icon name="folder" size={12} color="var(--fg-3)"/>
          <span style={{ color:'var(--fg-0)' }}>platform-auth</span>
          <Icon name="chevDown" size={12} color="var(--fg-3)"/>
        </button>
        {!compact && (
          <div style={{
            fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg-4)',
            display:'flex', gap: 10
          }}>
            <span>4 repos</span>
            <span>·</span>
            <span>7 worktrees</span>
            <span>·</span>
            <span>8 sessions</span>
          </div>
        )}

        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap: 10 }}>
          {/* live fleet readout */}
          <span style={{
            fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg-3)',
            display:'inline-flex', alignItems:'center', gap: 10, letterSpacing:'.05em'
          }}>
            {!compact && <span style={{ display:'inline-flex', alignItems:'center', gap: 5, color:'var(--warning)' }}>
              <StatusDot status="awaiting-input" size={6}/> 1 AWAITING
            </span>}
            <span style={{ display:'inline-flex', alignItems:'center', gap: 5, color:'var(--danger)' }}>
              <StatusDot status="blocked" size={6}/> 2 URGENT
            </span>
            <span style={{ display:'inline-flex', alignItems:'center', gap: 5, color:'var(--accent)' }}>
              <StatusDot status="running" size={6}/> 2 RUNNING
            </span>
          </span>
          <Divider v style={{ height: 18, margin:'0 4px' }}/>
          <button className="btn-ghost" style={{
            background:'transparent', border:'1px solid var(--line)',
            width: 28, height: 28, display:'inline-flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', color:'var(--fg-2)'
          }}>
            <Icon name="search" size={14}/>
          </button>
          <button className="btn-ghost" style={{
            background:'transparent', border:'1px solid var(--line)',
            width: 28, height: 28, display:'inline-flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', color:'var(--fg-2)', position:'relative'
          }}>
            <Icon name="bell" size={14}/>
            <span style={{
              position:'absolute', top:-3, right:-3, width: 8, height: 8, background:'var(--warning)'
            }}/>
          </button>
          <div style={{
            width: 26, height: 26, border:'1px solid var(--line-hi)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-0)'
          }}>EK</div>
        </div>
      </div>

      {/* body: left rail + content */}
      <div style={{ flex: 1, minHeight: 0, display:'flex', position:'relative' }}>
        {railOpen && <div style={{
          width: 188, borderRight:'1px solid var(--line)',
          display:'flex', flexDirection:'column', flexShrink: 0, background:'var(--bg-0)',
          position: compact ? 'absolute' : 'relative',
          top: 0, bottom: 0, left: 0, zIndex: 40,
          boxShadow: compact ? '8px 0 20px rgba(0,0,0,0.3)' : 'none'
        }}>
          <div style={{ padding:'14px 12px 6px' }}>
            <Label>Screens</Label>
          </div>
          {screens.map(s => {
            const active = screen === s.k;
            return (
              <button key={s.k} onClick={()=>setScreen(s.k)} style={{
                background: active ? 'var(--bg-2)' : 'transparent',
                border: 0, cursor: 'pointer', textAlign:'left',
                padding:'9px 12px', display:'flex', alignItems:'center', gap: 10,
                borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                color: active ? 'var(--fg-0)' : 'var(--fg-2)',
                fontFamily:'var(--font-sans)', fontSize: 13
              }}>
                <Icon name={s.icon} size={14} color={active ? 'var(--accent)' : 'var(--fg-3)'}/>
                <div style={{ minWidth: 0 }}>
                  <div style={{ lineHeight: 1.2 }}>{s.label}</div>
                  <div style={{
                    fontFamily:'var(--font-mono)', fontSize: 9.5, color:'var(--fg-4)',
                    letterSpacing:'.04em', textTransform:'uppercase', marginTop: 2
                  }}>{s.sub}</div>
                </div>
              </button>
            );
          })}

          <div style={{ padding:'18px 12px 6px' }}>
            <Label>Edge states</Label>
          </div>
          <div style={{ overflow:'auto', flex: 1, paddingBottom: 8 }}>
            {stateScreens.map(s => {
              const active = screen === s.k;
              return (
                <button key={s.k} onClick={()=>setScreen(s.k)} style={{
                  background: active ? 'var(--bg-2)' : 'transparent',
                  border: 0, cursor:'pointer', textAlign:'left',
                  padding:'6px 12px 6px 26px', display:'block', width:'100%',
                  borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  color: active ? 'var(--fg-0)' : 'var(--fg-3)',
                  fontFamily:'var(--font-mono)', fontSize: 11
                }}>{s.label}</button>
              );
            })}
          </div>
        </div>}
        {compact && railOpen && <div onClick={()=>setRailOpen(false)} style={{
          position:'absolute', inset:0, background:'rgba(0,0,0,0.4)', zIndex: 35
        }}/>}

        <div style={{ flex: 1, minHeight: 0, overflow:'hidden', display:'flex', flexDirection:'column' }}>
          {children}
        </div>
      </div>

      {/* status bar */}
      <div style={{
        height: 24, borderTop:'1px solid var(--line)', flexShrink: 0,
        display:'flex', alignItems:'center', padding:'0 12px', gap: 14,
        fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)',
        letterSpacing:'.04em'
      }}>
        <span style={{ color:'var(--accent)', display:'inline-flex', alignItems:'center', gap: 6 }}>
          <StatusDot status="running" size={6}/> flock.local
        </span>
        <span>→ 8 pi workers · 5 engaged</span>
        <span>·</span>
        <span>rook 0.4.1</span>
        <span>·</span>
        <span>quota 12 / 16 cores</span>
        <span style={{ marginLeft:'auto' }}>14:44:07 PDT · up 2d 4h</span>
      </div>
    </div>
  );
};

Object.assign(window, { Shell });
