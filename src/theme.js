const palettes = {
  dark: {
    bg:'#070B12',
    surface:'#0D1220',
    card:'#111827',
    cardHover:'#141D2E',
    border:'#1C2537',
    borderBright:'#2A3655',
    accent:'#3B82F6',
    accentLight:'#60A5FA',
    green:'#10B981',
    red:'#EF4444',
    yellow:'#F59E0B',
    purple:'#8B5CF6',
    cyan:'#06B6D4',
    text:'#F1F5F9',
    textSub:'#94A3B8',
    textDim:'#475569',
    glass:'rgba(255,255,255,0.03)',
  },
  light: {
    bg:'#E9EEF5',
    surface:'#F1F5FA',
    card:'#F7FAFE',
    cardHover:'#EDF3FA',
    border:'#C8D3E1',
    borderBright:'#B7C4D5',
    accent:'#1E40AF',
    accentLight:'#1D4ED8',
    green:'#0F766E',
    red:'#B42318',
    yellow:'#A16207',
    purple:'#6B46C1',
    cyan:'#0E7490',
    text:'#0B1A2B',
    textSub:'#31465E',
    textDim:'#5A7088',
    glass:'rgba(248,251,255,0.72)',
  },
}

function createBase(colors) {
  return {
    card: { background:colors.card, border:`1px solid ${colors.border}`, borderRadius:16, padding:24 },
    label: { fontSize:11, fontWeight:700, color:colors.textSub, letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:6, display:'block' },
    input: { width:'100%', background:colors.surface, border:`1px solid ${colors.border}`, borderRadius:10, padding:'9px 13px', color:colors.text, fontSize:14, outline:'none', fontFamily:'inherit', boxSizing:'border-box', transition:'border-color 0.2s, background 0.2s, color 0.2s' },
  }
}

export const C = { ...palettes.dark }
export const base = createBase(C)

export function getStoredTheme() {
  if (typeof window === 'undefined') return 'dark'
  return window.localStorage.getItem('surgimetrics_theme') || window.localStorage.getItem('surgiflow_theme') || 'dark'
}

export function applyTheme(mode = 'dark') {
  const next = palettes[mode] || palettes.dark
  Object.assign(C, next)
  Object.assign(base, createBase(next))

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = mode
    document.documentElement.style.colorScheme = mode === 'light' ? 'light' : 'dark'
    document.body.style.background = next.bg
    document.body.style.color = next.text
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem('surgimetrics_theme', mode)
    window.localStorage.removeItem('surgiflow_theme')
  }
}

if (typeof window !== 'undefined') {
  applyTheme(getStoredTheme())
}
