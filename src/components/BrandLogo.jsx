import { C } from '../theme.js'

export function BrandLogo({ size = 'md', showWordmark = true, dark = false }) {
  const scale = size === 'sm' ? 0.74 : size === 'lg' ? 1.32 : 1
  const navy = dark ? '#163A68' : C.text
  const teal = '#1FB6AD'

  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:12 * scale }}>
      <svg
        width={60 * scale}
        height={54 * scale}
        viewBox="0 0 60 54"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M49 6L36 15H15C8.4 15 3 20.4 3 27C3 33.6 8.4 39 15 39"
          stroke={teal}
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11 48L24 39H45C51.6 39 57 33.6 57 27C57 20.4 51.6 15 45 15"
          stroke={navy}
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M49 6V19" stroke={teal} strokeWidth="10" strokeLinecap="round" />
      </svg>

      {showWordmark && (
        <div style={{ fontSize:34 * scale, lineHeight:0.95, fontWeight:800, letterSpacing:'-0.05em', whiteSpace:'nowrap' }}>
          <span style={{ color:navy }}>Surgi</span>
          <span style={{ color:teal }}>Metrics</span>
        </div>
      )}
    </div>
  )
}
