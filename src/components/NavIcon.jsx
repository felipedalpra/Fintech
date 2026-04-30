const BASE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function NavIcon({ name, size = 14, style }) {
  const props = { ...BASE, width: size, height: size, viewBox: '0 0 24 24', style: { display: 'block', flexShrink: 0, ...style }, 'aria-hidden': 'true' }

  switch (name) {
    case 'dashboard': return (
      <svg {...props}>
        <rect x="3" y="3" width="7" height="9" rx="1.5"/>
        <rect x="14" y="3" width="7" height="5" rx="1.5"/>
        <rect x="14" y="12" width="7" height="9" rx="1.5"/>
        <rect x="3" y="16" width="7" height="5" rx="1.5"/>
      </svg>
    )
    case 'procedures': return (
      <svg {...props}>
        <rect x="9" y="2" width="6" height="4" rx="1"/>
        <path d="M16 3.5H18a2 2 0 0 1 2 2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2h2"/>
        <path d="M9 13h6"/>
        <path d="M12 10v6"/>
      </svg>
    )
    case 'surgery': return (
      <svg {...props}>
        <circle cx="6" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="m20 4-8.12 11.88"/>
        <path d="m14.47 14.48 5.53 5.52"/>
        <path d="m8.12 8.12 3.88 3.88"/>
      </svg>
    )
    case 'consultations': return (
      <svg {...props}>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    )
    case 'calendar': return (
      <svg {...props}>
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4"/>
        <path d="M8 2v4"/>
        <path d="M3 10h18"/>
        <circle cx="8" cy="15" r="1" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="15" r="1" fill="currentColor" stroke="none"/>
        <circle cx="16" cy="15" r="1" fill="currentColor" stroke="none"/>
        <circle cx="8" cy="19" r="1" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none"/>
      </svg>
    )
    case 'products': return (
      <svg {...props}>
        <path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/>
        <path d="M12 22V12"/>
        <path d="m3.3 7 8.7 5 8.7-5"/>
        <path d="m7.5 4.27 9 5.15"/>
      </svg>
    )
    case 'finance': return (
      <svg {...props}>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>
    )
    case 'taxes': return (
      <svg {...props}>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>
        <path d="M14 2v4a2 2 0 0 0 2 2h4"/>
        <path d="m9 15 6-6"/>
        <circle cx="9.5" cy="10.5" r="1.5"/>
        <circle cx="14.5" cy="15.5" r="1.5"/>
      </svg>
    )
    case 'goals': return (
      <svg {...props}>
        <circle cx="12" cy="12" r="10"/>
        <circle cx="12" cy="12" r="6"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
    )
    case 'recurrences': return (
      <svg {...props}>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
    )
    case 'reports': return (
      <svg {...props}>
        <line x1="18" x2="18" y1="20" y2="10"/>
        <line x1="12" x2="12" y1="20" y2="4"/>
        <line x1="6" x2="6" y1="20" y2="14"/>
        <path d="M2 20h20"/>
      </svg>
    )
    case 'ai': return (
      <svg {...props}>
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3z"/>
        <path d="M5 3v4"/>
        <path d="M19 17v4"/>
        <path d="M3 5h4"/>
        <path d="M17 19h4"/>
      </svg>
    )
    case 'billing': return (
      <svg {...props}>
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <line x1="2" x2="22" y1="10" y2="10"/>
        <path d="M6 15h2"/>
        <path d="M10 15h4"/>
      </svg>
    )
    case 'settings': return (
      <svg {...props}>
        <line x1="21" x2="14" y1="4" y2="4"/>
        <line x1="10" x2="3" y1="4" y2="4"/>
        <line x1="21" x2="12" y1="12" y2="12"/>
        <line x1="8" x2="3" y1="12" y2="12"/>
        <line x1="21" x2="16" y1="20" y2="20"/>
        <line x1="12" x2="3" y1="20" y2="20"/>
        <circle cx="12" cy="4" r="2"/>
        <circle cx="10" cy="12" r="2"/>
        <circle cx="14" cy="20" r="2"/>
      </svg>
    )
    default: return (
      <svg {...props}>
        <circle cx="12" cy="12" r="5"/>
      </svg>
    )
  }
}
