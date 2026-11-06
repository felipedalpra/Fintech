import { C } from '../theme.js'
import { fmtBRL, fmtInt } from '../lib/metaMetrics.js'
import { seriesScale } from '../lib/metaSeries.js'

// Gráficos do painel de Anúncios.
//
// Decisões que seguem o guia de dataviz do projeto:
// — Um eixo por gráfico. Investimento e leads viram DOIS gráficos pequenos lado a lado, nunca
//   duas escalas no mesmo desenho, que é o erro de leitura mais comum em painel de marketing.
// — Marca fina, topo arredondado, folga de 2px entre barras.
// — Sem dado no período não vira gráfico achatado em zero: vira uma frase.
// — Cor é identidade, não decoração: a mesma métrica usa a mesma cor em todos os gráficos.

export const SERIES_COLORS = { spend: '#3B82F6', leads: '#059669', clicks: '#8B5CF6', cpl: '#D97706' }

function diaCurto(iso) {
  const [, mes, dia] = String(iso).split('-')
  return `${dia}/${mes}`
}

// Barras diárias. `fmt` formata o valor no tooltip e no rótulo do pico.
export function DailyBars({ points = [], metric, label, color, fmt = fmtInt, testId }) {
  const escala = seriesScale(points, metric)
  const s = {
    card: { padding: 14, borderRadius: 14, border: `1px solid ${C.border}`, background: C.card },
    title: { fontSize: 12.5, fontWeight: 800, color: C.text },
    empty: { color: C.textDim, fontSize: 12, padding: '26px 0', textAlign: 'center' },
    plot: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 92, marginTop: 12 },
    axis: { display: 'flex', justifyContent: 'space-between', color: C.textDim, fontSize: 10, marginTop: 6 },
  }

  if (!escala || !escala.hasData) {
    return (
      <div style={s.card} data-testid={testId}>
        <div style={s.title}>{label}</div>
        <div style={s.empty}>Sem dado no período.</div>
      </div>
    )
  }

  const pico = points.reduce((acc, p) => (Number(p[metric] || 0) > Number(acc?.[metric] || 0) ? p : acc), null)

  return (
    <div style={s.card} data-testid={testId}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={s.title}>{label}</span>
        <span style={{ fontSize: 11, color: C.textSub }}>pico {fmt(pico?.[metric])} em {diaCurto(pico?.date)}</span>
      </div>
      <div style={s.plot} role="img" aria-label={`${label}, ${points.length} dias`}>
        {points.map(point => {
          const valor = Number(point[metric] || 0)
          const altura = Math.max((valor / escala.max) * 100, valor > 0 ? 3 : 0)
          return (
            <div
              key={point.date}
              title={`${diaCurto(point.date)} · ${fmt(point[metric])}`}
              style={{
                flex: 1, minWidth: 2, height: `${altura}%`,
                background: valor > 0 ? color : 'transparent',
                borderRadius: '4px 4px 0 0',
                borderBottom: valor > 0 ? 'none' : `1px solid ${C.border}`,
              }}
            />
          )
        })}
      </div>
      <div style={s.axis}>
        <span>{diaCurto(points[0]?.date)}</span>
        <span>{diaCurto(points[points.length - 1]?.date)}</span>
      </div>
    </div>
  )
}

// Comparação entre campanhas: barras horizontais ordenadas, um hue só — a comparação é de
// magnitude, não de identidade, então cor categórica aqui só atrapalharia.
export function CampaignComparison({ rows = [], metric = 'spend', label, fmt = fmtBRL, testId }) {
  const ordenado = [...rows]
    .filter(row => Number.isFinite(Number(row?.[metric])) && Number(row[metric]) > 0)
    .sort((a, b) => Number(b[metric]) - Number(a[metric]))
    .slice(0, 8)
  const max = ordenado[0] ? Number(ordenado[0][metric]) : 0

  const s = {
    card: { padding: 14, borderRadius: 14, border: `1px solid ${C.border}`, background: C.card },
    title: { fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 12 },
    row: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 92px', gap: 10, alignItems: 'center', marginBottom: 9 },
    name: { fontSize: 11.5, color: C.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    track: { height: 7, borderRadius: 999, background: `${C.border}55`, overflow: 'hidden', marginTop: 4 },
    value: { fontSize: 11.5, fontWeight: 700, color: C.text, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  }

  if (ordenado.length === 0) {
    return (
      <div style={s.card} data-testid={testId}>
        <div style={s.title}>{label}</div>
        <div style={{ color: C.textDim, fontSize: 12, padding: '20px 0', textAlign: 'center' }}>Sem dado no período.</div>
      </div>
    )
  }

  return (
    <div style={s.card} data-testid={testId}>
      <div style={s.title}>{label}</div>
      {ordenado.map(row => (
        <div key={row.ref_id} style={s.row}>
          <div>
            <div style={s.name} title={row.name || row.ref_id}>{row.name || row.ref_id}</div>
            <div style={s.track}>
              <div style={{ width: `${max ? (Number(row[metric]) / max) * 100 : 0}%`, height: '100%', background: SERIES_COLORS.spend, borderRadius: 999 }} />
            </div>
          </div>
          <div style={s.value}>{fmt(row[metric])}</div>
        </div>
      ))}
    </div>
  )
}
