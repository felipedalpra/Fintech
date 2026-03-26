import { useMemo, useState } from 'react'
import { C } from '../theme.js'
import { fmt, getPeriodRange, today } from '../utils.js'
import { buildMetrics } from '../useMetrics.js'
import { Card, Btn, FInput } from './UI.jsx'

// ─── Tabelas IRPF 2024/2025 ──────────────────────────────────────────────────

// Tabela progressiva mensal Carnê-Leão 2024 (vigente em 2025)
const CARNE_LEAO_TABLE = [
  { ate: 2259.20,  aliquota: 0,     deducao: 0 },
  { ate: 2826.65,  aliquota: 0.075, deducao: 169.44 },
  { ate: 3751.05,  aliquota: 0.15,  deducao: 381.44 },
  { ate: 4664.68,  aliquota: 0.225, deducao: 662.77 },
  { ate: Infinity, aliquota: 0.275, deducao: 896.00 },
]

// Tabela progressiva anual IRPF 2024
const IRPF_ANUAL_TABLE = [
  { ate: 26963.20,  aliquota: 0,     deducao: 0 },
  { ate: 33919.80,  aliquota: 0.075, deducao: 2023.74 },
  { ate: 45012.60,  aliquota: 0.15,  deducao: 4590.57 },
  { ate: 55976.16,  aliquota: 0.225, deducao: 7966.22 },
  { ate: Infinity,  aliquota: 0.275, deducao: 10762.99 },
]

// Dedução por dependente (mensal)
const DEDUCAO_DEPENDENTE_MENSAL = 189.59
const DEDUCAO_DEPENDENTE_ANUAL = 2275.08
// Dedução INSS autônomo: 20% do salário base limitado ao teto
const TETO_INSS = 7786.02
const ALIQUOTA_INSS_AUTONOMO = 0.20

function calcIRPF(baseCalculo, table) {
  for (const faixa of table) {
    if (baseCalculo <= faixa.ate) {
      return Math.max(0, baseCalculo * faixa.aliquota - faixa.deducao)
    }
  }
  return 0
}

function calcINSS(rendaBruta) {
  const base = Math.min(rendaBruta, TETO_INSS)
  return base * ALIQUOTA_INSS_AUTONOMO
}

function getMesLabel(monthKey) {
  if (!monthKey) return ''
  const [y, m] = monthKey.split('-')
  const d = new Date(parseInt(y), parseInt(m) - 1, 1)
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaxCalculator({ data }) {
  const [regime, setRegime] = useState('pf') // pf | simples | lucro_presumido
  const [dependentes, setDependentes] = useState(0)
  const [deducoesExtras, setDeducoesExtras] = useState(0) // deduções mensais extras (previdência privada, etc)
  const [mesRef, setMesRef] = useState(() => today().slice(0, 7))
  const [showAnual, setShowAnual] = useState(false)
  const [aliquotaSimples, setAliquotaSimples] = useState(6) // % Simples Nacional

  // Buscar receitas do mês de referência
  const range = useMemo(() => {
    const [y, m] = mesRef.split('-')
    const start = `${y}-${m}-01`
    const last = new Date(parseInt(y), parseInt(m), 0)
    const end = `${y}-${m}-${String(last.getDate()).padStart(2, '0')}`
    return { start, end }
  }, [mesRef])

  const m = useMemo(() =>
    buildMetrics(data, { startDate: range.start, endDate: range.end, balanceDate: range.end })
  , [data, range])

  // Receita bruta do mês
  const rendaBrutaMensal = m.grossRevenue

  // Cálculo Carnê-Leão (PF autônomo)
  const carneLeao = useMemo(() => {
    if (regime !== 'pf') return null
    const inss = calcINSS(rendaBrutaMensal)
    const dedDependentes = dependentes * DEDUCAO_DEPENDENTE_MENSAL
    const baseCalculo = Math.max(0, rendaBrutaMensal - inss - dedDependentes - deducoesExtras)
    const imposto = calcIRPF(baseCalculo, CARNE_LEAO_TABLE)
    const aliquotaEfetiva = rendaBrutaMensal > 0 ? (imposto / rendaBrutaMensal) * 100 : 0

    const faixaAtual = CARNE_LEAO_TABLE.find(f => baseCalculo <= f.ate)

    return {
      rendaBruta: rendaBrutaMensal,
      inss,
      dedDependentes,
      deducoesExtras,
      baseCalculo,
      imposto,
      aliquotaEfetiva,
      aliquotaNominal: (faixaAtual?.aliquota || 0) * 100,
      liquido: rendaBrutaMensal - inss - imposto,
    }
  }, [regime, rendaBrutaMensal, dependentes, deducoesExtras])

  // Simulação anual: soma os 12 meses ou extrapola o mês atual
  const anual = useMemo(() => {
    if (regime !== 'pf') return null
    // Pega receitas dos últimos 12 meses
    const yearStart = `${mesRef.slice(0, 4)}-01-01`
    const yearEnd = `${mesRef.slice(0, 4)}-12-31`
    const mAnual = buildMetrics(data, { startDate: yearStart, endDate: yearEnd, balanceDate: yearEnd })
    const rendaBrutaAnual = mAnual.grossRevenue

    const inssAnual = calcINSS(rendaBrutaAnual / 12) * 12
    const dedDependentesAnual = dependentes * DEDUCAO_DEPENDENTE_ANUAL
    const deducoesExtrasAnual = deducoesExtras * 12
    const baseAnual = Math.max(0, rendaBrutaAnual - inssAnual - dedDependentesAnual - deducoesExtrasAnual)
    const impostoAnual = calcIRPF(baseAnual, IRPF_ANUAL_TABLE)
    const aliquotaEfetiva = rendaBrutaAnual > 0 ? (impostoAnual / rendaBrutaAnual) * 100 : 0

    return {
      rendaBruta: rendaBrutaAnual,
      inss: inssAnual,
      dedDependentes: dedDependentesAnual,
      deducoesExtras: deducoesExtrasAnual,
      baseCalculo: baseAnual,
      imposto: impostoAnual,
      aliquotaEfetiva,
      liquido: rendaBrutaAnual - inssAnual - impostoAnual,
    }
  }, [regime, data, mesRef, dependentes, deducoesExtras])

  // Simples Nacional
  const simples = useMemo(() => {
    if (regime !== 'simples') return null
    const aliquota = aliquotaSimples / 100
    const imposto = rendaBrutaMensal * aliquota
    return {
      rendaBruta: rendaBrutaMensal,
      imposto,
      aliquotaEfetiva: aliquotaSimples,
      liquido: rendaBrutaMensal - imposto,
    }
  }, [regime, rendaBrutaMensal, aliquotaSimples])

  // Lucro Presumido
  const lucroPresumido = useMemo(() => {
    if (regime !== 'lucro_presumido') return null
    const lucroPct = 0.32 // 32% para serviços profissionais (médicos)
    const baseIR = rendaBrutaMensal * lucroPct
    const ir = baseIR * 0.15
    const csll = rendaBrutaMensal * 0.32 * 0.09
    const cofins = rendaBrutaMensal * 0.03
    const pis = rendaBrutaMensal * 0.0065
    const iss = rendaBrutaMensal * 0.05 // ISS aprox
    const total = ir + csll + cofins + pis + iss
    return {
      rendaBruta: rendaBrutaMensal,
      ir, csll, cofins, pis, iss,
      total,
      aliquotaEfetiva: rendaBrutaMensal > 0 ? (total / rendaBrutaMensal) * 100 : 0,
      liquido: rendaBrutaMensal - total,
    }
  }, [regime, rendaBrutaMensal])

  const mesLabel = getMesLabel(mesRef)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header */}
      <Card style={{ padding: 20, background: `linear-gradient(135deg, ${C.surface}, ${C.card})` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Simulador de Impostos</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.text }}>Carnê-Leão & IRPF</div>
            <div style={{ fontSize: 13, color: C.textDim, marginTop: 4, maxWidth: 500 }}>Calcule o imposto devido baseado nas suas receitas registradas no sistema. Os valores são estimativas — consulte seu contador para declaração oficial.</div>
          </div>
        </div>
      </Card>

      {/* Config row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <FInput
          label="Mês de referência"
          type="month"
          value={mesRef}
          onChange={setMesRef}
        />
        <FInput
          label="Regime tributário"
          value={regime}
          onChange={setRegime}
          options={[
            { v: 'pf', l: 'Pessoa Física (Carnê-Leão)' },
            { v: 'simples', l: 'Simples Nacional' },
            { v: 'lucro_presumido', l: 'Lucro Presumido' },
          ]}
        />
        {regime === 'pf' && (
          <FInput
            label="Nº de dependentes"
            type="number"
            value={dependentes}
            onChange={v => setDependentes(Math.max(0, Math.floor(v)))}
          />
        )}
        {regime === 'pf' && (
          <FInput
            label="Outras deduções mensais (R$)"
            type="number"
            value={deducoesExtras}
            onChange={setDeducoesExtras}
            placeholder="Previdência privada, etc."
          />
        )}
        {regime === 'simples' && (
          <FInput
            label="Alíquota Simples (%)"
            type="number"
            value={aliquotaSimples}
            onChange={v => setAliquotaSimples(Math.min(33, Math.max(0, v)))}
          />
        )}
      </div>

      {/* Receita do mês */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {[
          ['Receita bruta', rendaBrutaMensal, C.green],
          ['Cirurgias', m.surgeryRevenue, C.accent],
          ['Consultas', m.consultationRevenue, C.cyan],
          ['Produtos', m.productSalesRevenue, C.yellow],
          ['Outras receitas', m.extraRevenueTotal, C.purple],
        ].map(([label, value, color]) => (
          <Card key={label} style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color }}>{fmt(value)}</div>
          </Card>
        ))}
      </div>

      {/* Resultado Carnê-Leão */}
      {regime === 'pf' && carneLeao && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Carnê-Leão — {mesLabel}</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <ResultCard label="Renda bruta" value={carneLeao.rendaBruta} color={C.green} />
            <ResultCard label="(-) INSS (20% até teto)" value={-carneLeao.inss} color={C.yellow} />
            {carneLeao.dedDependentes > 0 && <ResultCard label={`(-) ${dependentes} dependente(s)`} value={-carneLeao.dedDependentes} color={C.yellow} />}
            {carneLeao.deducoesExtras > 0 && <ResultCard label="(-) Outras deduções" value={-carneLeao.deducoesExtras} color={C.yellow} />}
            <ResultCard label="= Base de cálculo" value={carneLeao.baseCalculo} color={C.accent} highlight />
            <ResultCard label="IRPF devido (Carnê-Leão)" value={carneLeao.imposto} color={C.red} highlight />
            <ResultCard label="Renda líquida estimada" value={carneLeao.liquido} color={carneLeao.liquido >= 0 ? C.green : C.red} highlight />
          </div>

          {/* DARF pill */}
          <Card style={{ padding: 20, border: `1px solid ${C.red}33`, background: C.red + '08' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>DARF a recolher — código 0190</div>
                <div style={{ fontSize: 11, color: C.textDim }}>Vencimento: último dia útil do mês seguinte · Pagar via banco ou Receita Federal</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: C.red }}>{fmt(carneLeao.imposto)}</div>
                <div style={{ fontSize: 12, color: C.textDim }}>Alíquota efetiva: {carneLeao.aliquotaEfetiva.toFixed(1)}%</div>
              </div>
            </div>
          </Card>

          {/* Tabela progressiva visual */}
          <Card style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 16 }}>Tabela progressiva mensal 2025 (Carnê-Leão)</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    {['Base de cálculo', 'Alíquota', 'Dedução', 'Situação'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CARNE_LEAO_TABLE.map((faixa, i) => {
                    const isCurrent = carneLeao.baseCalculo <= faixa.ate &&
                      (i === 0 || carneLeao.baseCalculo > CARNE_LEAO_TABLE[i - 1].ate)
                    const labels = ['Isento', '7,5%', '15%', '22,5%', '27,5%']
                    const prev = i === 0 ? 0 : CARNE_LEAO_TABLE[i - 1].ate
                    return (
                      <tr key={i} style={{
                        borderBottom: `1px solid ${C.border}22`,
                        background: isCurrent ? C.accent + '12' : 'transparent',
                      }}>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: C.textSub }}>
                          {fmt(prev)} — {faixa.ate === Infinity ? 'acima' : fmt(faixa.ate)}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 700, color: faixa.aliquota === 0 ? C.green : faixa.aliquota >= 0.225 ? C.red : C.yellow }}>
                          {labels[i]}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 13, color: C.textDim }}>
                          {faixa.deducao > 0 ? fmt(faixa.deducao) : '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {isCurrent && (
                            <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, background: C.accent + '18', borderRadius: 6, padding: '2px 8px' }}>
                              ← sua faixa
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Simulação anual */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setShowAnual(v => !v)}
              style={{
                background: showAnual ? C.accent + '18' : 'transparent',
                color: showAnual ? C.accentLight : C.textSub,
                border: `1px solid ${showAnual ? C.accent + '44' : C.border}`,
                borderRadius: 999, padding: '8px 16px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s',
              }}
            >
              {showAnual ? '▲' : '▼'} Projeção anual {mesRef.slice(0, 4)}
            </button>
          </div>

          {showAnual && anual && (
            <Card style={{ padding: 20, border: `1px solid ${C.purple}33` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 16 }}>Projeção IRPF anual — {mesRef.slice(0, 4)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <ResultCard label="Renda bruta anual" value={anual.rendaBruta} color={C.green} />
                <ResultCard label="(-) INSS estimado" value={-anual.inss} color={C.yellow} />
                <ResultCard label="= Base de cálculo" value={anual.baseCalculo} color={C.accent} />
                <ResultCard label="IRPF anual estimado" value={anual.imposto} color={C.red} highlight />
                <ResultCard label="Renda líquida anual" value={anual.liquido} color={C.green} highlight />
              </div>
              <div style={{ marginTop: 14, padding: 12, background: C.surface, borderRadius: 10, fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
                <strong style={{ color: C.textSub }}>Atenção:</strong> Esta projeção usa as receitas acumuladas no ano {mesRef.slice(0, 4)} registradas no sistema. Na declaração anual, deduções com saúde, educação e dependentes podem reduzir significativamente o imposto — consulte seu contador.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Simples Nacional */}
      {regime === 'simples' && simples && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Simples Nacional — {mesLabel}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <ResultCard label="Receita bruta" value={simples.rendaBruta} color={C.green} />
            <ResultCard label={`DAS (${aliquotaSimples}%)`} value={simples.imposto} color={C.red} highlight />
            <ResultCard label="Receita líquida" value={simples.liquido} color={C.green} highlight />
          </div>
          <Card style={{ padding: 16, border: `1px solid ${C.yellow}33`, background: C.yellow + '08' }}>
            <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
              <strong style={{ color: C.yellow }}>Simples Nacional:</strong> O DAS unifica IRPJ, CSLL, PIS, COFINS, CPP e ISS. A alíquota varia conforme o Anexo (geralmente Anexo III ou V para médicos) e a receita bruta acumulada dos últimos 12 meses. Ajuste a alíquota conforme sua faixa na tabela do Simples.
            </div>
          </Card>
        </div>
      )}

      {/* Lucro Presumido */}
      {regime === 'lucro_presumido' && lucroPresumido && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Lucro Presumido — {mesLabel}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <ResultCard label="Receita bruta" value={lucroPresumido.rendaBruta} color={C.green} />
            <ResultCard label="IRPJ (15% s/ 32%)" value={lucroPresumido.ir} color={C.red} />
            <ResultCard label="CSLL (9% s/ 32%)" value={lucroPresumido.csll} color={C.red} />
            <ResultCard label="PIS (0,65%)" value={lucroPresumido.pis} color={C.yellow} />
            <ResultCard label="COFINS (3%)" value={lucroPresumido.cofins} color={C.yellow} />
            <ResultCard label="ISS (~5%)" value={lucroPresumido.iss} color={C.yellow} />
            <ResultCard label="Total de tributos" value={lucroPresumido.total} color={C.red} highlight />
            <ResultCard label="Receita líquida" value={lucroPresumido.liquido} color={C.green} highlight />
          </div>
          <Card style={{ padding: 16, border: `1px solid ${C.yellow}33`, background: C.yellow + '08' }}>
            <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
              <strong style={{ color: C.yellow }}>Lucro Presumido:</strong> Base de cálculo presumida de 32% da receita para serviços médicos. IRPJ pode ter adicional de 10% sobre lucro presumido que exceder R$ 20.000/mês. ISS varia por município (2% a 5%). Os valores são estimativas — verifique com seu contador.
            </div>
          </Card>
        </div>
      )}

      {/* Disclaimer */}
      <Card style={{ padding: 16, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7 }}>
          <strong style={{ color: C.textSub }}>Aviso legal:</strong> Este simulador é uma ferramenta de estimativa para planejamento financeiro. Os cálculos são baseados nas tabelas vigentes da Receita Federal para 2025. Valores reais podem variar conforme deduções específicas, regimes especiais, e decisões contábeis. Sempre consulte um contador habilitado (CRC) antes de recolher impostos ou preencher declarações.
        </div>
      </Card>
    </div>
  )
}

function ResultCard({ label, value, color, highlight }) {
  return (
    <Card style={{
      padding: 16,
      border: highlight ? `1px solid ${color}44` : undefined,
      background: highlight ? color + '08' : undefined,
    }}>
      <div style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: highlight ? 20 : 17, fontWeight: 800, color }}>
        {value < 0 ? '-' : ''}{fmt(Math.abs(value))}
      </div>
    </Card>
  )
}
