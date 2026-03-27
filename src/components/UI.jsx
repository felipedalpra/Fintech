import { C, base } from '../theme.js'

function isLightHexColor(hex) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return false
  const raw = hex.slice(1)
  const normalized = raw.length === 3
    ? raw.split('').map(char => char + char).join('')
    : raw
  if (normalized.length !== 6) return false
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return false
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.72
}

// Inject skeleton animation once
if (typeof document !== 'undefined') {
  const id = 'surgimetrics-skeleton-styles'
  if (!document.getElementById(id)) {
    const el = document.createElement('style')
    el.id = id
    el.textContent = `
      @keyframes skeletonPulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 1; }
      }
    `
    document.head.appendChild(el)
  }
}

export function Card({ children, style, glow }) {
  const lightTheme = isLightHexColor(C.bg)
  const defaultShadow = lightTheme ? '0 10px 26px rgba(15,23,42,0.08)' : '0 2px 16px rgba(0,0,0,0.5)'
  const glowShadow = lightTheme
    ? `0 0 0 1px ${glow}40, 0 12px 26px rgba(15,23,42,0.08)`
    : `0 0 32px ${glow}`
  return <div style={{ ...base.card, boxShadow: glow ? glowShadow : defaultShadow, ...style }}>{children}</div>
}

export function Btn({ children, onClick, variant='primary', disabled, style }) {
  const v = {
    primary:{ background:C.accent,       color:'#fff',    border:'none' },
    ghost:  { background:'transparent',  color:C.textSub, border:`1px solid ${C.border}` },
    danger: { background:C.red+'20',     color:C.red,     border:`1px solid ${C.red}40` },
    success:{ background:C.green+'20',   color:C.green,   border:`1px solid ${C.green}40` },
    warn:   { background:C.yellow+'20',  color:C.yellow,  border:`1px solid ${C.yellow}40` },
  }[variant]
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ ...v, padding:'9px 18px', borderRadius:10, fontSize:13, fontWeight:600,
        cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.5:1,
        fontFamily:'inherit', transition:'opacity 0.15s', whiteSpace:'nowrap', ...style }}
      onMouseEnter={e=>{ if(!disabled) e.currentTarget.style.opacity='0.8' }}
      onMouseLeave={e=>{ e.currentTarget.style.opacity='1' }}>
      {children}
    </button>
  )
}

export function FInput({ label, value, onChange, type='text', placeholder, options, required }) {
  return (
    <div style={{ display:'flex', flexDirection:'column' }}>
      {label && <label style={base.label}>{label}{required&&<span style={{color:C.red}}> *</span>}</label>}
      {options
        ? <select value={value} onChange={e=>onChange(e.target.value)}
            style={{ ...base.input, appearance:'none', cursor:'pointer' }}>
            {options.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        : <input type={type} value={value} placeholder={placeholder}
            onChange={e=>onChange(type==='number'?(parseFloat(e.target.value)||0):e.target.value)}
            style={base.input}
            onFocus={e=>(e.currentTarget.style.borderColor=C.accent)}
            onBlur={e=>(e.currentTarget.style.borderColor=C.border)} />
      }
    </div>
  )
}

export function Progress({ val, max, color=C.accent, h=7 }) {
  const pct = Math.min(100, max>0?(val/max)*100:0)
  const done = pct>=100
  const lightTheme = isLightHexColor(C.bg)
  return (
    <div style={{ background:C.border, borderRadius:99, height:h, overflow:'hidden' }}>
      <div style={{ width:`${pct}%`, height:'100%', borderRadius:99, transition:'width 0.6s cubic-bezier(.4,0,.2,1)',
        background: done?`linear-gradient(90deg,${C.green},${C.cyan})`:`linear-gradient(90deg,${color}CC,${color})`,
        boxShadow: lightTheme ? 'none' : `0 0 8px ${done?C.green:color}88` }} />
    </div>
  )
}

export function Badge({ color, children, small }) {
  return (
    <span style={{ background:color+'22', color, border:`1px solid ${color}44`,
      borderRadius:6, padding:small?'2px 8px':'4px 12px',
      fontSize:small?11:12, fontWeight:700, letterSpacing:'0.04em', whiteSpace:'nowrap' }}>
      {children}
    </span>
  )
}

export function Modal({ open, onClose, title, children, width=520 }) {
  if (!open) return null
  const lightTheme = isLightHexColor(C.bg)
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
      display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:20 }}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:C.card, border:`1px solid ${C.borderBright}`, borderRadius:20,
        padding:28, width:'100%', maxWidth:width, maxHeight:'90vh', overflowY:'auto',
        boxShadow: lightTheme ? '0 24px 60px rgba(15,23,42,0.18)' : '0 24px 80px rgba(0,0,0,0.7)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
          <h3 style={{ margin:0, fontSize:18, fontWeight:700, color:C.text }}>{title}</h3>
          <button onClick={onClose} style={{ background:C.border, border:'none', color:C.textSub,
            width:32, height:32, borderRadius:8, cursor:'pointer', fontSize:18,
            display:'flex', alignItems:'center', justifyContent:'center' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function SkeletonBlock({ w = '100%', h = 16, radius = 8, style }) {
  return (
    <div style={{
      width: typeof w === 'number' ? w : w,
      height: typeof h === 'number' ? h : h,
      borderRadius: radius,
      background: C.border,
      animation: 'skeletonPulse 1.6s ease-in-out infinite',
      ...style,
    }} />
  )
}

export function ConfirmModal({ open, onClose, onConfirm, message }) {
  return (
    <Modal open={open} onClose={onClose} title="Confirmar Exclusão" width={400}>
      <p style={{ color:C.textSub, marginBottom:24 }}>{message||'Tem certeza? Esta ação não pode ser desfeita.'}</p>
      <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn variant="danger" onClick={()=>{ onConfirm(); onClose() }}>Excluir</Btn>
      </div>
    </Modal>
  )
}
