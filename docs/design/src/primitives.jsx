/* global React */
const { useState, useEffect, useRef } = React;

// ---------- Status tokens -------------------------------------------------
// Urgency order: awaiting-input, blocked, failed > running > idle, done
const STATUS = {
  'awaiting-input': { label: 'AWAITING INPUT', color: 'var(--warning)',  urgent: true,  glyph: '◆' },
  'blocked':        { label: 'BLOCKED',        color: 'var(--danger)',   urgent: true,  glyph: '■' },
  'failed':         { label: 'FAILED',         color: 'var(--danger)',   urgent: true,  glyph: '✕' },
  'running':        { label: 'RUNNING',        color: 'var(--accent)',   urgent: false, glyph: '●' },
  'idle':           { label: 'IDLE',           color: 'var(--fg-3)',     urgent: false, glyph: '○' },
  'done':           { label: 'DONE',           color: 'var(--fg-1)',     urgent: false, glyph: '✓' },
  'historical':     { label: 'HISTORICAL',     color: 'var(--fg-4)',     urgent: false, glyph: '—' }
};

// Pulsing dot. Non-color urgency cues: glyph shape + thick ring for urgent.
const StatusDot = ({ status = 'running', size = 8, ring = false }) => {
  const s = STATUS[status] || STATUS.idle;
  const anim = status === 'running' ? 'wtf-pulse 1.8s ease-out infinite'
             : status === 'awaiting-input' ? 'wtf-pulse-warn 1.8s ease-out infinite'
             : status === 'blocked' || status === 'failed' ? 'wtf-pulse-danger 1.8s ease-out infinite'
             : 'none';
  return (
    <span style={{
      display:'inline-block', width: size, height: size, borderRadius: 999,
      background: s.color, animation: anim, flexShrink: 0,
      outline: ring ? `2px solid ${s.color}` : 'none', outlineOffset: 2
    }}/>
  );
};

// A status badge that does NOT rely on color alone.
// - urgent statuses get a filled block + inverse glyph
// - non-urgent get outline
const StatusTag = ({ status = 'running', size = 'md' }) => {
  const s = STATUS[status] || STATUS.idle;
  const urgent = s.urgent;
  const pad = size === 'sm' ? '2px 6px' : '3px 8px';
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:6, padding: pad,
      fontFamily:'var(--font-mono)', fontSize: fs, letterSpacing:'.05em',
      textTransform:'uppercase', whiteSpace:'nowrap',
      background: urgent ? s.color : 'transparent',
      color: urgent ? '#0A0A0A' : s.color,
      border: urgent ? 'none' : `1px solid ${s.color}`,
      fontWeight: urgent ? 700 : 500
    }}>
      <span style={{ fontSize: fs }}>{s.glyph}</span>
      {s.label}
    </span>
  );
};

const Badge = ({ tone = 'default', children, mono = true }) => {
  const styles = {
    default: { border: '1px solid var(--line-hi)', color: 'var(--fg-2)' },
    accent:  { border: '1px solid var(--accent)', color: 'var(--accent)' },
    danger:  { border: '1px solid var(--danger)', color: 'var(--danger)' },
    warn:    { border: '1px solid var(--warning)', color: 'var(--warning)' },
    solid:   { background: 'var(--fg-0)', color: '#0A0A0A', fontWeight: 600, border:'none' },
    faint:   { border: '1px solid var(--line)', color: 'var(--fg-3)' }
  };
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:5,
      padding:'2px 7px',
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      fontSize: 10, letterSpacing:'.06em',
      textTransform:'uppercase', whiteSpace:'nowrap',
      ...styles[tone]
    }}>{children}</span>
  );
};

const Button = ({ variant = 'primary', size = 'md', icon, children, full, ...rest }) => {
  const base = {
    fontFamily: 'var(--font-sans)', fontWeight: variant==='primary' || variant==='danger' ? 600 : 500,
    border: 0, cursor: 'pointer', letterSpacing: '-0.005em',
    transition: 'background 120ms var(--ease-out), border-color 120ms var(--ease-out)',
    display: 'inline-flex', alignItems:'center', gap: 8, justifyContent:'center',
    width: full ? '100%' : 'auto', whiteSpace:'nowrap'
  };
  const sizes = {
    xs: { padding: '4px 8px',  fontSize: 11 },
    sm: { padding: '6px 10px', fontSize: 12 },
    md: { padding: '8px 14px', fontSize: 13 },
    lg: { padding: '11px 18px', fontSize: 14 }
  };
  const variants = {
    primary:   { background: 'var(--accent)', color: '#0A0A0A' },
    ghost:     { background: 'transparent', color: 'var(--fg-0)', border: '1px solid var(--line-hi)' },
    secondary: { background: 'var(--bg-2)', color: 'var(--fg-0)', border: '1px solid var(--line)' },
    danger:    { background: 'var(--danger)', color: '#0A0A0A' },
    warn:      { background: 'var(--warning)', color: '#0A0A0A', fontWeight: 600 },
    link:      { background: 'transparent', color: 'var(--fg-2)', padding: 0 }
  };
  const cls = variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : 'btn-ghost';
  return (
    <button className={cls} style={{...base, ...sizes[size], ...variants[variant]}} {...rest}>
      {icon}{children}
    </button>
  );
};

// Tiny inline icons built from strokes (Lucide-style, 1.5 stroke) --------
const Icon = ({ name, size = 14, color = 'currentColor' }) => {
  const props = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill:'none', stroke: color, strokeWidth: 1.6,
    strokeLinecap:'square', strokeLinejoin:'miter',
    style: { display:'block', flexShrink: 0 }
  };
  const P = { chev:  <path d="M9 6l6 6-6 6"/>,
              chevDown: <path d="M6 9l6 6 6-6"/>,
              chevUp: <path d="M6 15l6-6 6 6"/>,
              arrow: <path d="M5 12h14M13 5l7 7-7 7"/>,
              arrowLeft: <path d="M19 12H5M11 19l-7-7 7-7"/>,
              plus:  <path d="M12 5v14M5 12h14"/>,
              x:     <path d="M6 6l12 12M6 18L18 6"/>,
              check: <path d="M4 12l5 5L20 6"/>,
              pin:   <><path d="M12 3l5 5-3 3 3 6H7l3-6-3-3z"/><path d="M12 16v5"/></>,
              play:  <path d="M7 5l12 7-12 7z"/>,
              stop:  <rect x="6" y="6" width="12" height="12"/>,
              refresh: <><path d="M3 12a9 9 0 019-9 9 9 0 016.36 2.64L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 01-9 9 9 9 0 01-6.36-2.64L3 16"/><path d="M3 21v-5h5"/></>,
              folder:<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>,
              file:  <><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></>,
              git:   <><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M6 9v2a3 3 0 003 3h6a3 3 0 003-3V9"/></>,
              branch:<><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 9v6a3 3 0 003 3h6"/></>,
              search:<><circle cx="11" cy="11" r="7"/><path d="M20 20l-3-3"/></>,
              term:  <><path d="M4 6h16v12H4z"/><path d="M7 10l3 2-3 2M12 14h5"/></>,
              bell:  <><path d="M6 18V11a6 6 0 0112 0v7"/><path d="M4 18h16M10 21h4"/></>,
              gear:  <><circle cx="12" cy="12" r="3"/><path d="M19 12l2 1-1 2-2-.5M5 12l-2 1 1 2 2-.5M12 5l1-2 2 1-.5 2M12 19l1 2 2-1-.5-2M17 7l2-1-1-2-2 .5M7 17l-2 1 1 2 2-.5M17 17l2 1-1 2-2-.5M7 7l-2-1 1-2 2 .5"/></>,
              eye:   <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
              send:  <path d="M3 11l18-8-8 18-2-8z"/>,
              pause: <><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></>,
              dot:   <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>,
              grip:  <><circle cx="9"  cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="9"  cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9"  cy="18" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1" fill="currentColor" stroke="none"/></>,
              link:  <><path d="M10 14a4 4 0 015.66 0l2 2a4 4 0 01-5.66 5.66l-1-1"/><path d="M14 10a4 4 0 00-5.66 0l-2 2a4 4 0 005.66 5.66l1-1"/></>,
              alert: <><path d="M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.7 3.86a2 2 0 00-3.4 0z"/><path d="M12 9v4M12 17v.01"/></>,
              info:  <><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M11 12h1v5h1"/></>,
              spark: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>,
              doc:   <><rect x="5" y="3" width="14" height="18"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
              plug:  <><path d="M9 2v5M15 2v5"/><path d="M7 7h10v4a5 5 0 01-10 0zM12 16v6"/></>,
              key:   <><circle cx="8" cy="15" r="4"/><path d="M11 12l10-10M16 7l2 2M14 9l2 2"/></>,
              shield:<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>,
              user:  <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></>,
              sliders: <><path d="M3 6h10M17 6h4M3 12h4M11 12h10M3 18h14M19 18h2"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></>,
              open:  <><path d="M15 3h6v6M21 3l-9 9"/><path d="M19 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6"/></>,
              layers:<><path d="M12 3l10 6-10 6L2 9z"/><path d="M2 15l10 6 10-6"/></>,
              compass:<><circle cx="12" cy="12" r="9"/><path d="M16 8l-2 6-6 2 2-6z"/></>,
              bolt:  <path d="M13 2L3 14h7l-1 8 10-12h-7z"/>,
              clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
              history: <><path d="M3 12a9 9 0 109-9"/><path d="M3 4v5h5"/><path d="M12 7v5l4 2"/></>
            };
  return <svg {...props}>{P[name]}</svg>;
};

const Kbd = ({ children }) => (
  <span style={{
    fontFamily:'var(--font-mono)', fontSize:10,
    padding:'1px 5px', border:'1px solid var(--line)', color:'var(--fg-3)',
    background:'var(--bg-2)'
  }}>{children}</span>
);

const Input = ({ mono = true, icon, full = true, ...rest }) => (
  <div style={{ position:'relative', width: full ? '100%' : 'auto' }}>
    {icon && <span style={{ position:'absolute', left: 10, top:'50%', transform:'translateY(-50%)', color:'var(--fg-3)', display:'flex' }}>{icon}</span>}
    <input {...rest} style={{
      width:'100%', background:'var(--bg-3)', color:'var(--fg-0)',
      border: '1px solid var(--line)',
      padding: icon ? '8px 12px 8px 30px' : '8px 12px',
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      fontSize: 12, outline:'none', borderRadius: 0
    }}/>
  </div>
);

const Label = ({ children, mono = true, style }) => (
  <div style={{
    fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
    fontSize: 10, letterSpacing: '.08em',
    textTransform:'uppercase', color:'var(--fg-3)',
    ...style
  }}>{children}</div>
);

// A titled region used repeatedly: hairline box with a label strip
const Panel = ({ label, meta, right, children, pad = true, flush, style }) => (
  <div style={{
    border:'1px solid var(--line)', background:'var(--bg-1)',
    display:'flex', flexDirection:'column', minHeight: 0, ...style
  }}>
    {label && (
      <div style={{
        padding:'8px 14px', borderBottom:'1px solid var(--line)',
        display:'flex', alignItems:'center', gap: 10, flexShrink: 0,
        background: 'var(--bg-1)'
      }}>
        <span style={{
          fontFamily:'var(--font-mono)', fontSize:10, letterSpacing:'.1em',
          textTransform:'uppercase', color:'var(--fg-3)', fontWeight: 500
        }}>{label}</span>
        {meta && <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--fg-4)' }}>{meta}</span>}
        <span style={{ marginLeft:'auto', display:'flex', gap: 6, alignItems:'center' }}>{right}</span>
      </div>
    )}
    <div style={{ flex: 1, minHeight: 0, padding: pad ? (flush ? 0 : 14) : 0, overflow:'auto' }}>
      {children}
    </div>
  </div>
);

// A box of mono keyvalues, terminal-ish
const KV = ({ rows }) => (
  <div style={{ fontFamily:'var(--font-mono)', fontSize: 11.5, lineHeight: 1.7 }}>
    {rows.map((r, i) => (
      <div key={i} style={{ display:'flex', gap: 16 }}>
        <span style={{ width: 100, color:'var(--fg-3)', textTransform:'uppercase', fontSize: 10, letterSpacing:'.06em', paddingTop: 2 }}>{r[0]}</span>
        <span style={{ color: r[2] || 'var(--fg-1)', flex: 1 }}>{r[1]}</span>
      </div>
    ))}
  </div>
);

const Divider = ({ v, style }) => (
  <div style={{
    [v ? 'width' : 'height']: 1,
    [v ? 'height' : 'width']: '100%',
    background:'var(--line)',
    ...style
  }}/>
);

// Urgency-ranked "reason chip" — why does this need attention?
const ReasonChip = ({ status, children }) => {
  const s = STATUS[status] || STATUS.running;
  if (!s.urgent) {
    return (
      <span style={{
        fontFamily:'var(--font-mono)', fontSize: 11, color:'var(--fg-2)',
        display:'inline-flex', alignItems:'center', gap: 6, lineHeight: 1.3
      }}>
        <span style={{ color:'var(--fg-3)' }}>↳</span>
        {children}
      </span>
    );
  }
  return (
    <span style={{
      fontFamily:'var(--font-sans)', fontSize: 12, color: s.color,
      display:'inline-flex', alignItems:'center', gap: 6, fontWeight: 500, lineHeight: 1.3
    }}>
      <span style={{ fontFamily:'var(--font-mono)' }}>{s.glyph}</span>
      {children}
    </span>
  );
};

// Viewport width hook — for responsive layout
const useViewportWidth = () => {
  const [w, setW] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 1600);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
};

Object.assign(window, {
  STATUS, StatusDot, StatusTag, Badge, Button, Icon, Kbd, Input, Label,
  Panel, KV, Divider, ReasonChip, useViewportWidth
});
