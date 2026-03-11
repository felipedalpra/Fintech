import { C } from '../theme.js'
import { Card } from './UI.jsx'
import { useTheme } from '../context/ThemeContext.jsx'

export function Settings() {
  const { mode, setTheme } = useTheme()
  const isLight = mode === 'light'

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
      <Card style={{ maxWidth:720 }}>
        <div style={{ display:'flex', justifyContent:'space-between', gap:20, alignItems:'center', flexWrap:'wrap' }}>
          <div>
            <div style={{ fontSize:11, color:C.textSub, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:8 }}>Visualização</div>
            <h3 style={{ margin:'0 0 8px', fontSize:22, color:C.text, letterSpacing:'-0.03em' }}>Modo da plataforma</h3>
            <p style={{ margin:0, color:C.textSub, fontSize:14, lineHeight:1.7, maxWidth:460 }}>
              O SurgiFlow abre por padrão em modo escuro. Ative a lanterna para usar o modo claro.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setTheme(isLight ? 'dark' : 'light')}
            aria-pressed={isLight}
            style={{
              width:88,
              height:88,
              borderRadius:28,
              border:`1px solid ${isLight ? C.accent : C.border}`,
              background:isLight ? `linear-gradient(180deg, ${C.yellow}22, ${C.accent}22)` : C.surface,
              color:isLight ? C.accent : C.textSub,
              display:'grid',
              placeItems:'center',
              cursor:'pointer',
              boxShadow:isLight ? `0 0 32px ${C.yellow}30` : 'none',
              transition:'transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
              fontFamily:'inherit',
            }}
            title={isLight ? 'Desligar modo claro' : 'Ativar modo claro'}
          >
            <div style={{ display:'grid', justifyItems:'center', gap:6 }}>
              <div style={{ fontSize:28, lineHeight:1 }}>🔦</div>
              <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                {isLight ? 'Ligada' : 'Desligada'}
              </div>
            </div>
          </button>
        </div>

        <div style={{ marginTop:24, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:12 }}>
          <ModeCard
            title="Modo escuro"
            active={!isLight}
            description="Visual padrão da plataforma, com contraste forte para uso prolongado."
          />
          <ModeCard
            title="Modo claro"
            active={isLight}
            description="Visual mais claro para ambientes iluminados e apresentações."
          />
        </div>
      </Card>
    </div>
  )
}

function ModeCard({ title, description, active }) {
  return (
    <div style={{ padding:16, borderRadius:16, border:`1px solid ${active ? C.accent + '55' : C.border}`, background:active ? C.accent + '10' : C.surface }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, marginBottom:8 }}>
        <div style={{ color:C.text, fontWeight:700 }}>{title}</div>
        <div style={{ width:10, height:10, borderRadius:999, background:active ? C.green : C.textDim }} />
      </div>
      <div style={{ color:C.textSub, fontSize:13, lineHeight:1.6 }}>{description}</div>
    </div>
  )
}
