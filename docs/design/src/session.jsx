/* global React */
// Selected session command center — full-screen variant of the same idea.
// Used when user navigates away from Home to focus entirely on one session.

const SessionScreen = ({ sessions, selectedId, onSelect }) => {
  const selected = sessions.find(s => s.id === selectedId) || sessions[0];
  const [tab, setTab] = React.useState('summary');

  return (
    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
      {/* session picker tabs on top */}
      <div style={{
        borderBottom:'1px solid var(--line)', padding:'0 14px',
        display:'flex', alignItems:'center', gap: 2, overflow:'auto', flexShrink: 0,
        background:'var(--bg-0)', height: 38
      }}>
        {sessions.slice(0, 6).map(s => {
          const active = s.id === selectedId;
          const st = STATUS[s.status];
          return (
            <button key={s.id} onClick={()=>onSelect(s.id)} style={{
              background: active ? 'var(--bg-2)' : 'transparent',
              border: 0, cursor:'pointer',
              padding:'8px 12px',
              display:'inline-flex', alignItems:'center', gap: 8,
              borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
              color: active ? 'var(--fg-0)' : 'var(--fg-3)',
              fontFamily:'var(--font-mono)', fontSize: 11, whiteSpace:'nowrap'
            }}>
              <StatusDot status={s.status} size={6}/>
              <span>{s.id}</span>
              <span style={{ color: active ? 'var(--fg-2)' : 'var(--fg-4)' }}>· {s.name.slice(0, 26)}{s.name.length>26?'…':''}</span>
            </button>
          );
        })}
        <span style={{ flex:1 }}/>
        <button style={{
          background:'transparent', border:0, color:'var(--fg-3)',
          padding:'4px 8px', cursor:'pointer'
        }}><Icon name="plus" size={13}/></button>
      </div>

      <CommandCenter session={selected}/>
    </div>
  );
};

Object.assign(window, { SessionScreen });
