/* global React */
// Settings / Connections
// Left: section nav. Right: the selected section's form.

const SettingsScreen = () => {
  const [sec, setSec] = React.useState('connections');
  const sections = [
    { k:'connections', label:'Connections',  icon:'plug' },
    { k:'workers',     label:'Pi workers',   icon:'bolt' },
    { k:'workspace',   label:'Workspace',    icon:'folder' },
    { k:'models',      label:'Models',       icon:'spark' },
    { k:'keys',        label:'Keys & tokens',icon:'key' },
    { k:'safety',      label:'Safety',       icon:'shield' },
    { k:'appearance',  label:'Appearance',   icon:'sliders' },
    { k:'account',     label:'Account',      icon:'user' }
  ];

  return (
    <div style={{ flex:1, minHeight:0, display:'flex', overflow:'hidden' }}>
      {/* left nav */}
      <div style={{
        width: 220, borderRight:'1px solid var(--line)', background:'var(--bg-0)',
        padding:'18px 0 10px', display:'flex', flexDirection:'column', flexShrink: 0
      }}>
        <div style={{ padding:'0 16px 10px' }}>
          <Label>Settings</Label>
        </div>
        {sections.map(s => {
          const active = sec === s.k;
          return (
            <button key={s.k} onClick={()=>setSec(s.k)} style={{
              background: active ? 'var(--bg-2)' : 'transparent',
              border: 0, cursor:'pointer', textAlign:'left',
              padding:'8px 16px', display:'flex', alignItems:'center', gap: 10,
              borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              color: active ? 'var(--fg-0)' : 'var(--fg-2)',
              fontFamily:'var(--font-sans)', fontSize: 13
            }}>
              <Icon name={s.icon} size={13} color={active ? 'var(--accent)' : 'var(--fg-3)'}/>
              {s.label}
            </button>
          );
        })}
      </div>

      {/* body */}
      <div style={{ flex:1, minHeight:0, overflow:'auto', padding:'22px 32px 40px' }}>
        <Label>{sec}</Label>
        <div style={{ fontSize: 26, fontWeight: 500, letterSpacing:'-0.02em', color:'var(--fg-0)', margin:'6px 0 20px' }}>
          {sec === 'connections' ? 'Connections' :
           sec === 'workers'     ? 'Pi workers' :
           sec === 'workspace'   ? 'Workspace' :
           sec === 'models'      ? 'Models' :
           sec === 'keys'        ? 'Keys & tokens' :
           sec === 'safety'      ? 'Safety' :
           sec === 'appearance'  ? 'Appearance' : 'Account'}
        </div>

        {sec === 'connections' && <ConnectionsBody/>}
        {sec === 'workers'     && <WorkersBody/>}
        {sec !== 'connections' && sec !== 'workers' && (
          <div style={{
            border:'1px dashed var(--line)', padding:'60px 20px',
            textAlign:'center', fontFamily:'var(--font-mono)', fontSize: 12, color:'var(--fg-4)',
            letterSpacing:'.04em', textTransform:'uppercase'
          }}>{sec} · section scaffold</div>
        )}
      </div>
    </div>
  );
};

const ConnectionsBody = () => {
  const conns = [
    { id:'rook',   name:'rook.local',       kind:'Rook daemon',        status:'ok',    detail:'v0.4.1 · 127.0.0.1:7744 · 2d 4h uptime' },
    { id:'git',    name:'github.com',       kind:'Git remote',         status:'ok',    detail:'PAT · read + write · 8 repos authorized' },
    { id:'anthro', name:'api.anthropic.com',kind:'Model provider',     status:'ok',    detail:'claude-sonnet-4.5 · claude-haiku-4.5' },
    { id:'oai',    name:'api.openai.com',   kind:'Model provider',     status:'degraded', detail:'elevated latency · last check 14:41' },
    { id:'linear', name:'linear.app',       kind:'Work items',         status:'off',   detail:'Not connected. Optional.' }
  ];
  return (
    <div>
      <div style={{ border:'1px solid var(--line)', background:'var(--bg-1)' }}>
        {conns.map((c, i) => (
          <div key={c.id} style={{
            padding:'14px 16px', display:'flex', alignItems:'center', gap: 14,
            borderBottom: i === conns.length - 1 ? 'none' : '1px solid var(--line)'
          }}>
            <StatusDot
              status={c.status === 'ok' ? 'running' : c.status === 'degraded' ? 'awaiting-input' : 'idle'}
              size={8}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display:'flex', alignItems:'center', gap: 10 }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize: 13, color:'var(--fg-0)' }}>{c.name}</span>
                <span style={{ fontFamily:'var(--font-sans)', fontSize: 11, color:'var(--fg-3)' }}>{c.kind}</span>
              </div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)', marginTop: 4 }}>
                {c.detail}
              </div>
            </div>
            <div style={{ display:'flex', gap: 6 }}>
              <Button variant="ghost" size="sm" icon={<Icon name="refresh" size={11}/>}>Test</Button>
              {c.status === 'off' ? <Button variant="primary" size="sm">Connect</Button> :
                <Button variant="ghost" size="sm">Configure</Button>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, display:'flex', gap: 8 }}>
        <Button variant="ghost" size="sm" icon={<Icon name="plus" size={12}/>}>Add connection</Button>
        <Button variant="ghost" size="sm">Import from config</Button>
      </div>
    </div>
  );
};

const WorkersBody = () => {
  const workers = [
    { id:'pi-0', host:'192.168.4.10', cpu:'4c', gpu:'L4',     engaged:'ses-0f3a', load: 54 },
    { id:'pi-1', host:'192.168.4.11', cpu:'4c', gpu:'L4',     engaged:'ses-7b12', load: 0  },
    { id:'pi-2', host:'192.168.4.12', cpu:'4c', gpu:'—',      engaged:'—',         load: 0  },
    { id:'pi-3', host:'192.168.4.13', cpu:'8c', gpu:'A10',    engaged:'ses-2c61', load: 72 },
    { id:'pi-4', host:'192.168.4.14', cpu:'4c', gpu:'—',      engaged:'ses-5e0d', load: 38 },
    { id:'pi-5', host:'192.168.4.15', cpu:'4c', gpu:'—',      engaged:'ses-9f41', load: 0  },
    { id:'pi-6', host:'192.168.4.16', cpu:'4c', gpu:'—',      engaged:'—',        load: 0  },
    { id:'pi-7', host:'192.168.4.17', cpu:'4c', gpu:'—',      engaged:'ses-4b20', load: 0  }
  ];
  return (
    <div style={{ border:'1px solid var(--line)', background:'var(--bg-1)' }}>
      <div style={{
        display:'grid', gridTemplateColumns:'80px 1fr 70px 70px 120px 1fr 60px',
        padding:'8px 14px', borderBottom:'1px solid var(--line)',
        fontFamily:'var(--font-mono)', fontSize: 10, letterSpacing:'.08em',
        textTransform:'uppercase', color:'var(--fg-4)'
      }}>
        <span>ID</span><span>HOST</span><span>CPU</span><span>GPU</span><span>ENGAGED</span><span>LOAD</span><span></span>
      </div>
      {workers.map((w, i) => (
        <div key={w.id} style={{
          display:'grid', gridTemplateColumns:'80px 1fr 70px 70px 120px 1fr 60px',
          padding:'10px 14px', alignItems:'center',
          borderBottom: i === workers.length - 1 ? 'none' : '1px solid var(--line)',
          fontFamily:'var(--font-mono)', fontSize: 12, color:'var(--fg-1)'
        }}>
          <span style={{ color:'var(--fg-0)' }}>{w.id}</span>
          <span style={{ color:'var(--fg-2)' }}>{w.host}</span>
          <span>{w.cpu}</span>
          <span style={{ color: w.gpu === '—' ? 'var(--fg-4)' : 'var(--fg-1)' }}>{w.gpu}</span>
          <span style={{ color: w.engaged === '—' ? 'var(--fg-4)' : 'var(--accent)' }}>{w.engaged}</span>
          <span style={{ display:'flex', alignItems:'center', gap: 10 }}>
            <span style={{
              flex: 1, height: 4, background:'var(--bg-3)',
              position:'relative', overflow:'hidden'
            }}>
              <span style={{
                position:'absolute', inset:0,
                width: `${w.load}%`,
                background: w.load > 60 ? 'var(--warning)' : 'var(--accent)'
              }}/>
            </span>
            <span style={{ width: 32, textAlign:'right', color:'var(--fg-3)', fontSize: 11 }}>{w.load}%</span>
          </span>
          <span style={{ textAlign:'right' }}>
            <button className="btn-ghost" style={{
              background:'transparent', border:'1px solid var(--line)',
              padding:'3px 6px', cursor:'pointer', color:'var(--fg-3)',
              fontFamily:'var(--font-mono)', fontSize: 10
            }}>⋯</button>
          </span>
        </div>
      ))}
    </div>
  );
};

Object.assign(window, { SettingsScreen });
