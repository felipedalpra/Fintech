// Biblioteca de criativos: funções puras que montam, filtram e ordenam os cards.
//
// Regra que atravessa o arquivo: AUSENTE ≠ ZERO. Um anúncio sem insight no período não
// "gastou R$ 0" — a Meta simplesmente não trouxe número para ele. Zerar transformaria
// desconhecido em afirmação, e é assim que um relatório mente sem ninguém perceber.

function div(a, b) { return b > 0 ? a / b : null }

/** Agrega os insights diários por anúncio e junta nome de campanha/conjunto. */
export function buildCreativeCards(ads, insights, campaignNames = {}, adsetNames = {}) {
  const porAd = new Map()
  for (const r of insights ?? []) {
    const cur = porAd.get(r.ref_id) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0 }
    cur.spend += Number(r.spend) || 0
    cur.impressions += Number(r.impressions) || 0
    cur.clicks += Number(r.clicks) || 0
    cur.leads += Number(r.leads) || 0
    porAd.set(r.ref_id, cur)
  }
  return (ads ?? []).map(a => {
    const m = porAd.get(a.ad_id)
    const base = {
      ad_id: a.ad_id,
      name: a.name ?? null,
      status: a.status ?? null,
      campaign_id: a.campaign_id ?? null,
      adset_id: a.adset_id ?? null,
      campaignName: a.campaign_id ? (campaignNames[a.campaign_id] ?? null) : null,
      adsetName: a.adset_id ? (adsetNames[a.adset_id] ?? null) : null,
      thumbnail_url: a.thumbnail_url ?? null,
      image_url: a.image_url ?? null,
      body_text: a.body_text ?? null,
      title_text: a.title_text ?? null,
      object_story_id: a.object_story_id ?? null,
    }
    if (!m) return { ...base, hasData: false, spend: null, impressions: null, clicks: null, leads: null, ctr: null, cpc: null }
    return {
      ...base, hasData: true,
      spend: m.spend, impressions: m.impressions, clicks: m.clicks, leads: m.leads,
      ctr: div(m.clicks, m.impressions) === null ? null : div(m.clicks, m.impressions) * 100,
      cpc: div(m.spend, m.clicks),
    }
  })
}

function norm(v) {
  return String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filterCreatives(cards, { q = '', campaignId = '', status = '' } = {}) {
  const termo = norm(q).trim()
  return (cards ?? []).filter(c => {
    if (campaignId && c.campaign_id !== campaignId) return false
    if (status && c.status !== status) return false
    if (!termo) return true
    // A clínica procura tanto pelo nome do anúncio quanto pelo da campanha a que ele pertence.
    return norm(c.name).includes(termo) || norm(c.campaignName).includes(termo)
  })
}

/**
 * Ordena por uma métrica. Valor indisponível vai SEMPRE para o fim, nas duas direções:
 * em ordem crescente, um null no topo se leria como "o CPC mais barato", que é falso.
 */
export function sortCreatives(cards, key, dir = 'desc') {
  const sinal = dir === 'asc' ? 1 : -1
  return [...(cards ?? [])].sort((a, b) => {
    const x = a[key]; const y = b[key]
    const xNull = x === null || x === undefined
    const yNull = y === null || y === undefined
    if (xNull && yNull) return 0
    if (xNull) return 1
    if (yNull) return -1
    return (x - y) * sinal
  })
}

/** Abre o anúncio no Gerenciador de Anúncios. Derivado do que já temos — sem campo novo da API. */
export function adsManagerLink(adAccountId, adId) {
  if (!adAccountId || !adId) return null
  const act = String(adAccountId).startsWith('act_') ? adAccountId : `act_${adAccountId}`
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(act)}&selected_ad_ids=${encodeURIComponent(adId)}`
}

/** Publicação pública do criativo. Só existe quando a Meta devolveu o id da publicação. */
export function metaPostLink(objectStoryId) {
  return objectStoryId ? `https://www.facebook.com/${objectStoryId}` : null
}
