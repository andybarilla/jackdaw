/* global React */
// Artifact viewer — plan / spec / memo / review / snapshot
// Left: document. Right: linked sessions + history.

const ArtifactScreen = ({ onSelect }) => {
  const doc = PLAN_DOC;
  return (
    <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* artifact header */}
      <div style={{
        padding:'16px 28px 14px', borderBottom:'1px solid var(--line)',
        display:'flex', alignItems:'flex-start', gap: 18, flexShrink: 0
      }}>
        <Icon name="doc" size={22} color="var(--fg-3)"/>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-3)',
            display:'flex', alignItems:'center', gap: 8
          }}>
            <Badge tone="accent">{doc.kind}</Badge>
            <span>plan-auth-refactor</span>
            <span style={{ color:'var(--fg-4)' }}>·</span>
            <span>updated {doc.updated}</span>
            <span style={{ color:'var(--fg-4)' }}>·</span>
            <span>@{doc.author}</span>
          </div>
          <div style={{
            fontSize: 32, fontWeight: 500, letterSpacing:'-0.03em',
            color:'var(--fg-0)', margin:'8px 0 0', lineHeight: 1.1
          }}>{doc.title}</div>
        </div>
        <div style={{ display:'flex', gap: 6 }}>
          <Button variant="ghost" size="sm" icon={<Icon name="link" size={12}/>}>Link session</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="history" size={12}/>}>History</Button>
          <Button variant="ghost" size="sm" icon={<Icon name="open" size={12}/>}>Open in editor</Button>
        </div>
      </div>

      <div style={{ flex:1, minHeight:0, display:'grid', gridTemplateColumns:'1fr 340px', overflow:'hidden' }}>
        {/* document body */}
        <div style={{ overflow:'auto', padding:'28px 48px 48px', background:'var(--bg-0)' }}>
          <div style={{ maxWidth: 720 }}>
            {doc.body.map((b, i) => {
              if (b.h === 1) return <h1 key={i} style={{ fontSize: 26, fontWeight: 500, letterSpacing:'-0.02em', color:'var(--fg-0)', margin:'18px 0 12px' }}>{b.text}</h1>;
              if (b.h === 2) return <h2 key={i} style={{ fontSize: 18, fontWeight: 500, letterSpacing:'-0.015em', color:'var(--fg-0)', margin:'24px 0 10px' }}>{b.text}</h2>;
              if (b.p)   return <p key={i} style={{ fontSize: 14.5, color:'var(--fg-1)', lineHeight: 1.65, margin:'0 0 12px' }}>{b.p.split(/`([^`]+)`/).map((t,j)=> j%2 ? <span key={j} className="t-code">{t}</span> : t)}</p>;
              if (b.li)  return <ul key={i} style={{ margin:'0 0 14px', padding:'0 0 0 18px', color:'var(--fg-1)', fontSize: 14, lineHeight: 1.7 }}>
                {b.li.map((l,j)=> <li key={j} style={{ fontFamily: l.includes('.ts') || l.includes('src/') ? 'var(--font-mono)' : 'inherit', fontSize: l.includes('src/') ? 12.5 : 14 }}>{l}</li>)}
              </ul>;
              if (b.ol)  return <ol key={i} style={{ margin:'0 0 14px', padding:'0 0 0 18px', color:'var(--fg-1)', fontSize: 14, lineHeight: 1.9, counterReset:'step' }}>
                {b.ol.map((l,j)=> {
                  const parts = l.split(' · ');
                  return (
                    <li key={j} style={{ marginBottom: 4 }}>
                      <span>{parts[0]}</span>
                      {parts[1] && <span style={{ marginLeft: 10, fontFamily:'var(--font-mono)', fontSize: 10.5, letterSpacing:'.06em', color: parts[1].includes('DONE') ? 'var(--fg-2)' : parts[1].includes('FAILED') || parts[1].includes('BLOCKED') ? 'var(--danger)' : parts[1].includes('IN PROGRESS') ? 'var(--accent)' : 'var(--fg-3)' }}>{parts[1]}</span>}
                    </li>
                  );
                })}
              </ol>;
              return null;
            })}
          </div>
        </div>

        {/* right column: linked sessions + snapshots */}
        <div style={{ overflow:'auto', borderLeft:'1px solid var(--line)', padding:'18px 16px', background:'var(--bg-0)' }}>
          <Label>Linked sessions <span style={{ color:'var(--fg-4)' }}>· 3</span></Label>
          <div style={{ marginTop: 10 }}>
            {SESSIONS.filter(s => s.linkedArtifact?.id === 'plan-auth-refactor').map(s => (
              <div key={s.id} onClick={()=>onSelect(s.id)} className="hover-row-2" style={{
                padding:'10px 12px', border:'1px solid var(--line)', background:'var(--bg-1)',
                marginBottom: 6, cursor:'pointer'
              }}>
                <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                  <StatusTag status={s.status} size="sm"/>
                  <span style={{ marginLeft:'auto', fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)' }}>{s.updated}</span>
                </div>
                <div style={{ fontSize: 13, color:'var(--fg-0)', marginTop: 6, letterSpacing:'-0.01em' }}>{s.name}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontSize: 10, color:'var(--fg-4)', marginTop: 4 }}>
                  → {s.id} · {s.branch}
                </div>
              </div>
            ))}
          </div>

          <Label style={{ marginTop: 22 }}>Decision history</Label>
          <div style={{
            marginTop: 10, border:'1px solid var(--line)', background:'var(--bg-1)',
            fontFamily:'var(--font-mono)', fontSize: 11
          }}>
            {[
              { t:'Apr 17 14:31', k:'edit', text:'EK updated plan (4 edits)' },
              { t:'Apr 17 13:52', k:'link', text:'linked ses-9f41 — docs draft' },
              { t:'Apr 17 10:14', k:'link', text:'linked ses-0f3a, ses-2c61' },
              { t:'Apr 17 09:02', k:'new',  text:'plan created from spec-session-api' }
            ].map((e, i) => (
              <div key={i} style={{
                padding:'6px 10px', display:'flex', gap: 10, alignItems:'baseline',
                borderBottom: i === 3 ? 'none' : '1px solid var(--line)'
              }}>
                <span style={{ color:'var(--fg-4)', width: 86 }}>{e.t}</span>
                <span style={{
                  color: e.k === 'edit' ? 'var(--accent)' : 'var(--fg-2)',
                  width: 40, textTransform:'uppercase', fontSize: 9.5, letterSpacing:'.06em'
                }}>{e.k}</span>
                <span style={{ color:'var(--fg-1)', flex:1 }}>{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { ArtifactScreen });
