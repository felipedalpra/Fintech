import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { C } from '../theme.js'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counter = useRef(0)

  const toast = useCallback((message, type = 'success', duration = 3000) => {
    const id = ++counter.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }, [])

  const dismiss = useCallback(id => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

const TYPE_STYLES = {
  success: { bg: '#10B981', icon: '✓' },
  error:   { bg: '#EF4444', icon: '✕' },
  warning: { bg: '#F59E0B', icon: '⚠' },
  info:    { bg: '#3B82F6', icon: 'ℹ' },
}

function ToastContainer({ toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return (
    <div style={{
      position: 'fixed',
      bottom: 28,
      right: 28,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }) {
  const style = TYPE_STYLES[toast.type] || TYPE_STYLES.success
  return (
    <div
      onClick={() => onDismiss(toast.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        borderRadius: 12,
        background: C.card,
        border: `1px solid ${style.bg}44`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px ${style.bg}22`,
        minWidth: 240,
        maxWidth: 360,
        pointerEvents: 'auto',
        cursor: 'pointer',
        animation: 'toastSlideIn 0.25s cubic-bezier(.4,0,.2,1)',
      }}
    >
      <span style={{
        width: 24,
        height: 24,
        borderRadius: 99,
        background: style.bg + '22',
        color: style.bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 800,
        flexShrink: 0,
      }}>{style.icon}</span>
      <span style={{ fontSize: 13, color: C.text, fontWeight: 600, flex: 1, lineHeight: 1.4 }}>
        {toast.message}
      </span>
    </div>
  )
}

// Inject keyframe animation once
if (typeof document !== 'undefined') {
  const styleId = 'surgimetrics-toast-styles'
  if (!document.getElementById(styleId)) {
    const el = document.createElement('style')
    el.id = styleId
    el.textContent = `
      @keyframes toastSlideIn {
        from { opacity: 0; transform: translateY(12px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
    `
    document.head.appendChild(el)
  }
}
