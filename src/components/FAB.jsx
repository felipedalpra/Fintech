import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { C } from '../theme.js'

const ACTIONS = [
  { label: 'Nova cirurgia',     icon: '◈', page: 'sales',         event: 'new-surgery',       color: C.accent },
  { label: 'Nova consulta',     icon: '◎', page: 'consultations',  event: 'new-consultation',  color: C.cyan },
  { label: 'Nova despesa',      icon: '↓', page: 'finance',        event: 'new-expense',       color: C.red },
  { label: 'Nova receita',      icon: '↑', page: 'finance',        event: 'new-extra-revenue', color: C.green },
]

export function FAB({ currentPage }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const handleAction = action => {
    setOpen(false)
    if (action.page === currentPage) {
      // Already on the right page — dispatch event to open modal directly
      window.dispatchEvent(new CustomEvent(action.event))
    } else {
      // Navigate and dispatch after a tick so the page mounts
      navigate(`/app/${action.page}`)
      setTimeout(() => window.dispatchEvent(new CustomEvent(action.event)), 120)
    }
  }

  return (
    <div ref={ref} style={{ position: 'fixed', bottom: 28, left: 28, zIndex: 500, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>

      {/* Action items */}
      {open && ACTIONS.map((action, i) => (
        <button
          key={action.label}
          onClick={() => handleAction(action)}
          title={action.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 16px 9px 12px',
            borderRadius: 12,
            background: C.card,
            border: `1px solid ${action.color}44`,
            color: C.text,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            boxShadow: `0 4px 20px rgba(0,0,0,0.4)`,
            animation: `fabItemIn 0.2s cubic-bezier(.4,0,.2,1) ${i * 0.04}s both`,
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{
            width: 26, height: 26, borderRadius: 8,
            background: action.color + '22', color: action.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, flexShrink: 0,
          }}>{action.icon}</span>
          {action.label}
        </button>
      ))}

      {/* Main FAB button */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Lançamento rápido"
        style={{
          width: 52, height: 52, borderRadius: 16,
          background: open
            ? `linear-gradient(135deg, ${C.red}CC, ${C.red})`
            : `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
          border: 'none',
          color: '#fff',
          fontSize: 22,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 24px ${C.accent}66`,
          transition: 'all 0.2s cubic-bezier(.4,0,.2,1)',
          transform: open ? 'rotate(45deg)' : 'none',
          flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.88' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
      >
        +
      </button>
    </div>
  )
}

// Inject animation
if (typeof document !== 'undefined') {
  const id = 'surgimetrics-fab-styles'
  if (!document.getElementById(id)) {
    const el = document.createElement('style')
    el.id = id
    el.textContent = `
      @keyframes fabItemIn {
        from { opacity: 0; transform: translateY(8px) scale(0.9); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
    `
    document.head.appendChild(el)
  }
}
