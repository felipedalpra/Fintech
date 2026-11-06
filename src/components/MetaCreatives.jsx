import { useEffect, useMemo, useState } from 'react'
import { C } from '../theme.js'
import { supabase } from '../lib/supabase.js'
import { adsManagerLink, buildCreativeCards, filterCreatives, metaPostLink, sortCreatives } from '../lib/metaCreatives.js'
import { fmtBRL, fmtInt, fmtPct } from '../lib/metaMetrics.js'

// Biblioteca de criativos: os anúncios reais da Meta com a imagem, o texto e o resultado de
// cada um. Espelho fiel — nada aqui é cruzado com o financeiro, e nada é inventado: quando a
// Meta não devolve uma métrica ou uma imagem, a tela diz isso em vez de mostrar zero.

const SORTS = [
  { key: 'spend', label: 'Investimento' },
  { key: 'ctr',   label: 'CTR' },
  { key: 'cpc',   label: 'CPC' },
]

const STATUS_LABEL = { ACTIVE: 'Ativo', PAUSED: 'Pausado', ARCHIVED: 'Arquivado', DELETED: 'Excluído' }
const statusLabel = s => STATUS_LABEL[s] ?? (s ? String(s).toLowerCase() : 'sem situação')

// Métrica ausente nunca vira 0: "—" diz "a Meta não trouxe", que é a verdade.
const mBRL = v => (v == null ? '—' : fmtBRL(v))
const mInt = v => (v == null ? '—' : fmtInt(v))
const mPct = v => (v == null ? '—' : fmtPct(v))

export default function MetaCreatives({ uid, since, until, periodLabel }) {
  const [ads, setAds] = useState([])
  const [insights, setInsights] = useState([])
  const [campaignNames, setCampaignNames] = useState({})
  const [adsetNames, setAdsetNames] = useState({})
  const [adAccountId, setAdAccountId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [q, setQ] = useState('')
  const [campaignId, setCampaignId] = useState('')
  const [status, setStatus] = useState('')
  const [sort, setSort] = useState({ key: 'spend', dir: 'desc' })
  const [aberto, setAberto] = useState(null)
  // A Meta assina e EXPIRA as URLs de miniatura. Quando a imagem falha, esconder a tag deixava
  // um retângulo vazio — o mesmo buraco mudo que a tela promete não ter. Registramos a falha
  // para dizer o motivo no lugar dela.
  const [imgQuebrada, setImgQuebrada] = useState({})
  const marcarQuebrada = id => setImgQuebrada(m => (m[id] ? m : { ...m, [id]: true }))

  useEffect(() => {
    if (!uid) return
    let mounted = true
    async function load() {
      setLoading(true); setError(null); setImgQuebrada({})
      // Tudo sai do cache que o sync já grava — a biblioteca não abre conexão própria com a
      // Meta nem dispara requisição por card.
      const [adsRes, insRes, campRes, setRes, connRes] = await Promise.all([
        supabase.from('meta_ads')
          .select('ad_id, adset_id, campaign_id, name, status, thumbnail_url, image_url, body_text, title_text, object_story_id')
          .eq('user_id', uid),
        supabase.from('meta_insights')
          .select('ref_id, spend, impressions, clicks, leads')
          .eq('user_id', uid).eq('level', 'ad').gte('date', since).lte('date', until),
        supabase.from('meta_campaigns').select('campaign_id, name').eq('user_id', uid),
        supabase.from('meta_adsets').select('adset_id, name').eq('user_id', uid),
        supabase.from('meta_connections').select('ad_account_id').eq('user_id', uid).maybeSingle(),
      ])
      if (!mounted) return
      if (adsRes.error) { setError(adsRes.error.message); setLoading(false); return }
      setAds(adsRes.data ?? [])
      setInsights(insRes.error ? [] : (insRes.data ?? []))
      setCampaignNames(Object.fromEntries((campRes.data ?? []).map(r => [r.campaign_id, r.name])))
      setAdsetNames(Object.fromEntries((setRes.data ?? []).map(r => [r.adset_id, r.name])))
      setAdAccountId(connRes.data?.ad_account_id ?? null)
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [uid, since, until])

  const cards = useMemo(
    () => buildCreativeCards(ads, insights, campaignNames, adsetNames),
    [ads, insights, campaignNames, adsetNames],
  )
  const visiveis = useMemo(
    () => sortCreatives(filterCreatives(cards, { q, campaignId, status }), sort.key, sort.dir),
    [cards, q, campaignId, status, sort],
  )
  // Só campanhas que de fato têm anúncio aqui — um filtro que devolve lista vazia sempre é ruído.
  const campanhasComAnuncio = useMemo(() => {
    const vistas = new Map()
    for (const c of cards) if (c.campaign_id && !vistas.has(c.campaign_id)) vistas.set(c.campaign_id, c.campaignName || c.campaign_id)
    return [...vistas].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'))
  }, [cards])

  const detalhe = aberto ? visiveis.find(c => c.ad_id === aberto) ?? cards.find(c => c.ad_id === aberto) : null

  const s = {
    bar: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 },
    input: { padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface,
      color: C.text, fontSize: 13, fontFamily: 'inherit', minWidth: 250 },
    select: { padding: '8px 10px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface,
      color: C.text, fontSize: 12.5, fontFamily: 'inherit' },
    sortBtn: on => ({ padding: '7px 12px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
      border: `1px solid ${on ? C.accent : C.border}`, background: on ? 'rgba(59,130,246,.16)' : C.surface,
      color: on ? C.accentLight : C.textSub, fontFamily: 'inherit' }),
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 },
    card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden',
      cursor: 'pointer', display: 'flex', flexDirection: 'column' },
    thumbBox: { aspectRatio: '1.91 / 1', background: C.surface, display: 'flex', alignItems: 'center',
      justifyContent: 'center', borderBottom: `1px solid ${C.border}`, overflow: 'hidden' },
    thumb: { width: '100%', height: '100%', objectFit: 'cover' },
    semImg: { fontSize: 11.5, color: C.textDim, textAlign: 'center', padding: '0 16px', lineHeight: 1.5 },
    body: { padding: 13, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 },
    nome: { fontSize: 13.5, fontWeight: 700, color: C.text, lineHeight: 1.35 },
    camp: { fontSize: 11.5, color: C.textDim },
    chip: on => ({ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700,
      padding: '3px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.05em',
      color: on ? C.green : C.textDim, background: on ? 'rgba(16,185,129,.14)' : 'rgba(148,163,184,.12)' }),
    mets: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 'auto', paddingTop: 10,
      borderTop: `1px solid ${C.border}` },
    mLab: { fontSize: 9.5, fontWeight: 700, color: C.textDim, letterSpacing: '.07em', textTransform: 'uppercase' },
    mVal: { fontSize: 13, fontWeight: 700, color: C.text, fontVariantNumeric: 'tabular-nums', marginTop: 2 },
    semDado: { fontSize: 11, color: C.yellow || '#F59E0B', marginTop: 'auto', paddingTop: 10, borderTop: `1px solid ${C.border}` },
    vazio: { textAlign: 'center', padding: '48px 20px', color: C.textSub, background: C.card,
      border: `1px solid ${C.border}`, borderRadius: 16, lineHeight: 1.6 },
    erro: { background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 12,
      padding: '12px 14px', color: '#fca5a5', fontSize: 12.5, lineHeight: 1.5 },
    // Painel lateral
    backdrop: { position: 'fixed', inset: 0, background: 'rgba(2,6,23,.6)', zIndex: 60 },
    drawer: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 100%)', background: C.bg,
      borderLeft: `1px solid ${C.border}`, zIndex: 61, overflowY: 'auto', padding: 20 },
    dTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
    fechar: { background: 'none', border: `1px solid ${C.border}`, color: C.textSub, borderRadius: 9,
      padding: '5px 10px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
    sec: { fontSize: 10.5, fontWeight: 700, color: C.textDim, letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 18, marginBottom: 7 },
    texto: { fontSize: 13, color: C.textSub, lineHeight: 1.6, whiteSpace: 'pre-wrap' },
    ausente: { fontSize: 12, color: C.textDim, fontStyle: 'italic', lineHeight: 1.55 },
    link: { display: 'inline-block', marginTop: 8, fontSize: 12.5, color: C.accentLight, textDecoration: 'none',
      border: `1px solid ${C.border}`, borderRadius: 9, padding: '7px 12px' },
    note: { fontSize: 11.5, color: C.textDim, marginTop: 16, lineHeight: 1.55 },
  }

  if (loading) return <div style={s.vazio}>Carregando os criativos…</div>
  if (error) {
    return (
      <div style={s.erro}>
        Não foi possível carregar os criativos: {error}
        <div style={{ marginTop: 6, color: C.textDim }}>Os números do painel não foram afetados — esta aba lê as mesmas tabelas já sincronizadas.</div>
      </div>
    )
  }

  return (
    <div>
      <div style={s.bar}>
        <input
          style={s.input} value={q} onChange={e => setQ(e.target.value)}
          placeholder="Buscar por anúncio ou campanha…" data-testid="creatives-search"
        />
        <select style={s.select} value={campaignId} onChange={e => setCampaignId(e.target.value)} data-testid="creatives-campaign">
          <option value="">Todas as campanhas</option>
          {campanhasComAnuncio.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
        </select>
        <select style={s.select} value={status} onChange={e => setStatus(e.target.value)} data-testid="creatives-status">
          <option value="">Ativos e pausados</option>
          <option value="ACTIVE">Ativos</option>
          <option value="PAUSED">Pausados</option>
        </select>
        {SORTS.map(o => (
          <button
            key={o.key} style={s.sortBtn(sort.key === o.key)} data-testid={`creatives-sort-${o.key}`}
            onClick={() => setSort(p => ({ key: o.key, dir: p.key === o.key && p.dir === 'desc' ? 'asc' : 'desc' }))}
          >
            {o.label}{sort.key === o.key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div style={s.vazio} data-testid="creatives-empty">
          {ads.length === 0
            ? 'Nenhum anúncio sincronizado ainda. Assim que a sincronização com o Meta rodar, os criativos aparecem aqui.'
            : 'Nenhum anúncio corresponde aos filtros. Limpe a busca, a campanha ou a situação para ver os demais.'}
        </div>
      ) : (
        <div style={s.grid} data-testid="creatives-grid">
          {visiveis.map(c => (
            <div key={c.ad_id} style={s.card} data-testid="creative-card" onClick={() => setAberto(c.ad_id)}>
              <div style={s.thumbBox}>
                {(c.thumbnail_url || c.image_url) && !imgQuebrada[c.ad_id]
                  ? <img src={c.image_url || c.thumbnail_url} alt="" style={s.thumb} loading="lazy"
                      onError={() => marcarQuebrada(c.ad_id)} />
                  : <span style={s.semImg} data-testid="creative-no-image">
                      {imgQuebrada[c.ad_id]
                        ? 'A imagem expirou no Meta — ela volta na próxima sincronização'
                        : 'A Meta não forneceu imagem para este criativo'}
                    </span>}
              </div>
              <div style={s.body}>
                <div>
                  <div style={s.nome} data-testid="creative-name">{c.name || 'Anúncio sem nome'}</div>
                  <div style={s.camp}>{c.campaignName || 'Campanha não identificada'}</div>
                </div>
                <div><span style={s.chip(c.status === 'ACTIVE')}>{statusLabel(c.status)}</span></div>
                {c.hasData ? (
                  <>
                    <div style={s.mets}>
                      <div><div style={s.mLab}>Investido</div><div style={s.mVal}>{mBRL(c.spend)}</div></div>
                      <div><div style={s.mLab}>CTR</div><div style={s.mVal}>{mPct(c.ctr)}</div></div>
                      <div><div style={s.mLab}>CPC</div><div style={s.mVal}>{mBRL(c.cpc)}</div></div>
                    </div>
                    <div style={{ ...s.mets, borderTop: 'none', paddingTop: 0 }}>
                      <div><div style={s.mLab}>Impressões</div><div style={s.mVal}>{mInt(c.impressions)}</div></div>
                      <div><div style={s.mLab}>Cliques</div><div style={s.mVal}>{mInt(c.clicks)}</div></div>
                      <div><div style={s.mLab}>Resultados</div><div style={s.mVal}>{mInt(c.leads)}</div></div>
                    </div>
                  </>
                ) : (
                  <div style={s.semDado} data-testid="creative-no-data">
                    Sem números no período ({periodLabel}) — a Meta não registrou entrega para este anúncio aqui.
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={s.note}>
        Tudo nesta aba vem direto do Meta Ads, da mesma sincronização que alimenta o painel — nada é
        somado ao financeiro. As miniaturas são servidas pela Meta e podem expirar; quando isso acontece,
        o card mostra o aviso no lugar da imagem, em vez de um espaço em branco.
      </div>

      {detalhe && (
        <>
          <div style={s.backdrop} onClick={() => setAberto(null)} />
          <aside style={s.drawer} data-testid="creative-drawer">
            <div style={s.dTop}>
              <div>
                <div style={{ ...s.nome, fontSize: 15 }}>{detalhe.name || 'Anúncio sem nome'}</div>
                <div style={s.camp}>
                  {detalhe.campaignName || 'Campanha não identificada'}
                  {detalhe.adsetName ? ` · ${detalhe.adsetName}` : ''}
                </div>
              </div>
              <button style={s.fechar} onClick={() => setAberto(null)} data-testid="creative-drawer-close">Fechar</button>
            </div>

            <div style={{ ...s.thumbBox, borderRadius: 12, border: `1px solid ${C.border}`, aspectRatio: 'auto', minHeight: 150 }}>
              {(detalhe.image_url || detalhe.thumbnail_url) && !imgQuebrada[detalhe.ad_id]
                ? <img src={detalhe.image_url || detalhe.thumbnail_url} alt="" style={{ width: '100%', display: 'block' }}
                    onError={() => marcarQuebrada(detalhe.ad_id)} />
                : <span style={s.semImg}>
                    {imgQuebrada[detalhe.ad_id]
                      ? 'A imagem expirou no Meta — ela volta na próxima sincronização'
                      : 'A Meta não forneceu imagem para este criativo'}
                  </span>}
            </div>

            <div style={s.sec}>Texto do anúncio</div>
            {detalhe.title_text && <div style={{ ...s.nome, marginBottom: 6 }}>{detalhe.title_text}</div>}
            {detalhe.body_text
              ? <div style={s.texto}>{detalhe.body_text}</div>
              : <div style={s.ausente}>A Meta não devolveu o texto deste criativo. Em anúncios criados fora do padrão (ou já arquivados) esse campo costuma vir vazio.</div>}

            <div style={s.sec}>Desempenho no período ({periodLabel})</div>
            {detalhe.hasData ? (
              <div style={{ ...s.mets, borderTop: 'none', paddingTop: 0, gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div><div style={s.mLab}>Investido</div><div style={s.mVal}>{mBRL(detalhe.spend)}</div></div>
                <div><div style={s.mLab}>Impressões</div><div style={s.mVal}>{mInt(detalhe.impressions)}</div></div>
                <div><div style={s.mLab}>Cliques</div><div style={s.mVal}>{mInt(detalhe.clicks)}</div></div>
                <div><div style={s.mLab}>CTR</div><div style={s.mVal}>{mPct(detalhe.ctr)}</div></div>
                <div><div style={s.mLab}>CPC</div><div style={s.mVal}>{mBRL(detalhe.cpc)}</div></div>
                <div><div style={s.mLab}>Resultados</div><div style={s.mVal}>{mInt(detalhe.leads)}</div></div>
              </div>
            ) : (
              <div style={s.ausente}>Nenhum número para este anúncio no período selecionado.</div>
            )}

            <div style={s.sec}>Abrir no Meta</div>
            {adsManagerLink(adAccountId, detalhe.ad_id)
              ? <a style={s.link} href={adsManagerLink(adAccountId, detalhe.ad_id)} target="_blank" rel="noreferrer" data-testid="creative-manager-link">
                  Ver no Gerenciador de Anúncios ↗
                </a>
              : <div style={s.ausente}>Conta de anúncios não identificada — reconecte em Configurações → Meta Ads.</div>}
            {metaPostLink(detalhe.object_story_id) && (
              <div>
                <a style={s.link} href={metaPostLink(detalhe.object_story_id)} target="_blank" rel="noreferrer">
                  Ver a publicação ↗
                </a>
              </div>
            )}
          </aside>
        </>
      )}
    </div>
  )
}
