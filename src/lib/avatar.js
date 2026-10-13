// src/lib/avatar.js
// Helpers PUROS de avatar (iniciais + cor determinística a partir de um rótulo/chave).
// Usados no CRM (tarefas, funil). Sem I/O, sem dependência de tema.

export const AVATAR_COLORS = ['#3B82F6', '#8B5CF6', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6']

// Iniciais a partir de um nome ou e-mail (até 2 letras, maiúsculas).
export function initials(label) {
  const s = String(label || '').split('@')[0].replace(/[._-]+/g, ' ').trim()
  const parts = s.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] || '?'
  const b = parts[1]?.[0] || parts[0]?.[1] || ''
  return (a + b).toUpperCase()
}

// Cor estável para uma chave (mesma entrada → mesma cor).
export function avatarColor(key) {
  const s = String(key || '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
