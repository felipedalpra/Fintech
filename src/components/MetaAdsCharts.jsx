import { useState } from 'react'
import { C } from '../theme.js'
import { fmtBRL, fmtInt } from '../lib/metaMetrics.js'
import { seriesScale } from '../lib/metaSeries.js'

// Gráficos do painel de Anúncios.
//
// Decisões que seguem o guia de dataviz do projeto:
// — Um eixo por gráfico. Investimento e leads viram DOIS gráficos pequenos lado a lado, nunca
//   duas escalas no mesmo desenho, que é o erro de leitura mais comum em painel de marketing.
// — Marca fina, topo arredondado, folga entre barras.
// — Sem dado no período não vira gráfico achatado em zero: vira uma frase.
// — Cor é identidade, não decoração: a mesma métrica usa a mesma cor em todos os gráficos.
// — Cabeçalho nunca quebra linha: o "pico" trunca com reticências antes de empurrar o gráfico
//   para baixo e desalinhar a linha de cartões (o valor completo continua no hover/foco da barra).
// — Hairlines de referência (0/50/100%) porque uma barra sem nada para comparar não comunica
//   magnitude; tooltip por barra substitui o `title` nativo do navegador.
// — NENHUMA barra tem largura mínima fixa nem o container tem min-width herdado do conteúdo:
//   com `minWidth` fixo em px, a largura somada das barras cresce junto com o nº de dias e, a
//   partir de um certo período (ex. Trimestre = ~90 dias), passa a ultrapassar a largura do
//   cartão e invade o cartão vizinho. As barras sempre encolhem para caber (flex-basis 0 +
//   min-width 0), e o espaçamento entre elas diminui conforme o período fica mais denso, para
//   que a largura total nunca dependa de quantos dias existem — só do espaço disponível.

export const SERIES_COLORS = { spend: '#3B82F6', leads: '#059669', clicks: '#8B5CF6', cpl: '#D97706' }

function diaCurto(iso) {
  const [, mes, dia] = String(iso).split('-')
  return `${dia}/${mes}`
}

// Barras diárias. `fmt` formata o valor no tooltip e no rótulo do pico.
export function DailyBars({ points = [], metric, label, color, fmt = fmtInt, testId }) {
  const [hoverIndex, setHoverIndex] = useState(null)
  const escala = seriesScale(points, metric)
  // Espaçamento diminui conforme o período fica mais denso — nunca deixa a largura total
  // (barras + folgas) depender de quantos dias existem, só do espaço que o cartão realmente tem.
  const gap = points.length > 120 ? 0 : points.length > 60 ? 1 : 2
  const s = {
    card: { padding: 14, borderRadius: 14, border: `1px solid ${C.border}`, background: C.card, minWidth: 0 },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 },
    title: { fontSize: 12.5, fontWeight: 800, color: C.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    peak: { fontSize: 11, color: C.textSub, flexShrink: 0, maxWidth: '58%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' },
    empty: { color: C.textDim, fontSize: 12, padding: '26px 0', textAlign: 'center' },
    plotWrap: { position: 'relative', marginTop: 14, minWidth: 0 },
    gridline: { position: 'absolute', left: 0, right: 0, height: 1, background: C.borderBright },
    // `overflow: hidden` aqui é o cinto e suspensório: com flex-basis 0 + min-width 0 nas barras,
    // a soma já cabe sempre no espaço disponível, mas isso garante que nenhuma arredondamento de
    // subpixel ou caso extremo escape visualmente para o cartão vizinho. O tooltip mora FORA
    // deste container (como irmão, dentro de plotWrap) exatamente para não ser cortado por ele.
    track: { position: 'relative', display: 'flex', alignItems: 'flex-end', gap, height: 92, minWidth: 0, overflow: 'hidden' },
    barSlot: { position: 'relative', flex: '1 1 0%', minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end' },
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
  const picoTexto = `Pico ${fmt(pico?.[metric])} em ${diaCurto(pico?.date)}`
  const total = points.length
  const hovered = hoverIndex != null ? points[hoverIndex] : null
  const tooltipAlign = hoverIndex == null ? 'center' : hoverIndex < total * 0.18 ? 'left' : hoverIndex > total * 0.82 ? 'right' : 'center'
  const tooltipPct = hoverIndex == null ? 0 : ((hoverIndex + 0.5) / total) * 100

  return (
    <div style={s.card} data-testid={testId}>
      <div style={s.header}>
        <span style={s.title} title={label}>{label}</span>
        <span style={s.peak} title={picoTexto}>{picoTexto}</span>
      </div>
      <div style={s.plotWrap}>
        <div style={{ ...s.gridline, top: 0 }} />
        <div style={{ ...s.gridline, top: '50%' }} />
        <div style={{ ...s.gridline, bottom: 0 }} />
        {hovered && (
          <div
            style={{
              position: 'absolute', bottom: '100%', marginBottom: 6, zIndex: 5, pointerEvents: 'none',
              left: tooltipAlign === 'left' ? 0 : tooltipAlign === 'right' ? 'auto' : `${tooltipPct}%`,
              right: tooltipAlign === 'right' ? 0 : 'auto',
              transform: tooltipAlign === 'center' ? 'translateX(-50%)' : 'none',
              display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 9px', borderRadius: 9,
              border: `1px solid ${C.borderBright}`, background: C.cardHover, boxShadow: '0 12px 28px rgba(0,0,0,.35)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: 10, color: C.textSub }}>{diaCurto(hovered.date)}</span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
              <i aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 2, background: color, borderRadius: 1 }} />
              {fmt(hovered[metric])}
            </span>
          </div>
        )}
        <div style={s.track} role="img" aria-label={`${label}, ${total} dias`}>
          {points.map((point, index) => {
            const valor = Number(point[metric] || 0)
            const altura = Math.max((valor / escala.max) * 100, valor > 0 ? 3 : 0)
            const isHover = hoverIndex === index
            const diaLabel = diaCurto(point.date)
            const valorLabel = fmt(point[metric])
            return (
              <div
                key={point.date}
                style={s.barSlot}
                tabIndex={valor > 0 ? 0 : -1}
                role="img"
                aria-label={`${diaLabel}: ${valorLabel}`}
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(current => (current === index ? null : current))}
                onFocus={() => setHoverIndex(index)}
                onBlur={() => setHoverIndex(current => (current === index ? null : current))}
              >
                <div
                  style={{
                    width: '100%', height: `${altura}%`,
                    background: valor > 0 ? color : 'transparent',
                    opacity: isHover ? 1 : valor > 0 ? 0.88 : 1,
                    filter: isHover ? 'brightness(1.2)' : 'none',
                    transition: 'opacity .12s, filter .12s',
                    borderRadius: '4px 4px 0 0',
                    borderBottom: valor > 0 ? 'none' : `1px solid ${C.border}`,
                    outline: isHover ? `1px solid ${C.borderBright}` : 'none',
                    outlineOffset: 1,
                  }}
                />
              </div>
            )
          })}
        </div>
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
