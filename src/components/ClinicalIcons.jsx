// Ícones da área clínica, no mesmo estilo de traço do NavIcon (stroke 1.75, cantos
// arredondados). Substituem símbolos de texto (⛶ ✓ × ! ◌ ＋ •••) por SVGs nítidos,
// que herdam a cor via currentColor e escalam bem em qualquer tamanho/tema.
const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function ClinicalIcon({ name, size = 14, style }) {
  const props = { ...BASE, width: size, height: size, viewBox: '0 0 24 24', style: { display: 'block', flexShrink: 0, ...style }, 'aria-hidden': 'true' }

  switch (name) {
    case 'expand': return (
      <svg {...props}>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
      </svg>
    )
    case 'check': return (
      <svg {...props} strokeWidth={2.25}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )
    case 'check-circle': return (
      <svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12.5 2.5 2.5 5-5" />
      </svg>
    )
    case 'close': return (
      <svg {...props} strokeWidth={2}>
        <path d="M18 6 6 18" />
        <path d="M6 6l12 12" />
      </svg>
    )
    case 'alert': return (
      <svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" />
        <circle cx="12" cy="16" r=".6" fill="currentColor" stroke="none" />
      </svg>
    )
    case 'spinner': return (
      <svg {...props} style={{ ...props.style, animation: 'clinical-spin 0.9s linear infinite' }}>
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
    )
    case 'plus': return (
      <svg {...props} strokeWidth={2.25}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    )
    case 'more': return (
      <svg {...props} strokeWidth={2.5}>
        <circle cx="5" cy="12" r=".6" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r=".6" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r=".6" fill="currentColor" stroke="none" />
      </svg>
    )
    case 'image': return (
      <svg {...props}>
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="m4 17 5-5 4 4 3-3 4 4" />
      </svg>
    )
    case 'document': return (
      <svg {...props}>
        <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M14 3v4h4" />
      </svg>
    )
    default: return null
  }
}
