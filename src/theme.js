const palettes = {
  dark: {
    bg:'#070B12',
    surface:'#0D1220',
    card:'#111827',
    cardHover:'#141D2E',
    // Bordas e texto apagado recalibrados para contraste real contra o card (eram 1.16:1 e
    // 2.34:1 — quase invisíveis); matiz mantido, só claridade/saturação mudaram.
    border:'#4B5D64',
    borderBright:'#567681',
    accent:'#3A81F5',
    accentLight:'#60A5FA',
    // green/yellow/cyan recalibrados para a faixa de luminosidade legível em fundo escuro
    // (estavam claros/lavados demais) e o amarelo ganhou mais distância do vermelho, que
    // antes ficavam fáceis de confundir lado a lado.
    green:'#00A66F',
    red:'#F14545',
    yellow:'#C38000',
    purple:'#956BFE',
    cyan:'#00A1C0',
    text:'#F1F5F9',
    textSub:'#94A3B8',
    textDim:'#667B83',
    glass:'rgba(255,255,255,0.03)',
  },
  light: {
    bg:'#E9EEF5',
    surface:'#F1F5FA',
    card:'#F7FAFE',
    cardHover:'#EDF3FA',
    // Mesma recalibração do modo escuro: bordas mais perceptíveis contra o card.
    border:'#9BAAAF',
    borderBright:'#7E929A',
    accent:'#0047B6',
    accentLight:'#1D4ED8',
    // green/cyan ganharam saturação (liam cinza antes) e o amarelo foi reequilibrado para
    // não se confundir com o vermelho — mesmos matizes, só a dosagem de cor mudou.
    green:'#007A46',
    red:'#BD0018',
    yellow:'#C36F00',
    purple:'#6E3ECF',
    cyan:'#007098',
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
