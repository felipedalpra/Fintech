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
    bg:'#F2F5F9',
    surface:'#F8FAFC',
    card:'#FFFFFF',
    cardHover:'#F3F6FA',
    border:'#D5DEE9',
    borderBright:'#C6D1DF',
    accent:'#1D4ED8',
    accentLight:'#2563EB',
    green:'#047857',
    red:'#B91C1C',
    yellow:'#B45309',
    purple:'#6D28D9',
    cyan:'#0E7490',
    text:'#0F1C2B',
    textSub:'#40566E',
    textDim:'#647A92',
    glass:'rgba(255,255,255,0.76)',
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
