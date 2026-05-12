import {
  appendSheetsRow,
  buildAlertHtml,
  createAdminClient,
  ensureSubscribers,
  fetchUserFinancialData,
  getConfig,
  getTodayISO,
  listAuthUsers,
  persistDispatchLog,
  persistRiskSnapshot,
  sendGmailHtml,
} from '../_lib/alerts.js'

function extractBearer(headers = {}) {
  const authHeader = headers.authorization || headers.Authorization || ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error:'Method not allowed' })
  }

  const config = getConfig()
  const cronHeader = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || ''
  const bearer = extractBearer(req.headers)
  const authorized = Boolean(config.cronSecret) && (cronHeader === config.cronSecret || bearer === config.cronSecret)
  if (!authorized) return res.status(401).json({ error:'Invalid cron secret' })

  const today = String(req.query?.referenceDate || getTodayISO())
  const dashboardUrl = String(req.query?.dashboardUrl || '')

  const admin = createAdminClient(config)

  try {
    const users = await listAuthUsers(admin)
    await ensureSubscribers(admin, users)

    const { data:subs, error:subErr } = await admin
      .from('alert_subscribers')
      .select('user_id, email, enabled')
      .eq('enabled', true)

    if (subErr) throw subErr

    const summary = { processed:0, sent:0, skipped:0, failures:0 }

    for (const sub of subs || []) {
      summary.processed += 1
      try {
        const analysis = await fetchUserFinancialData(admin, sub.user_id, today)

        await persistRiskSnapshot(admin, sub.user_id, today, analysis.riskLevel, analysis.triggerKeys, analysis.payload)

        await appendSheetsRow([
          today,
          sub.user_id,
          sub.email,
          analysis.riskLevel,
          analysis.triggerKeys.join(','),
          Number(analysis.payload.projectedDeficit || 0),
          Number(analysis.payload.dueIn7Total || 0),
          Number(analysis.payload.overduePayablesTotal || 0),
        ], 'risk_daily_snapshot', config)

        if (!analysis.triggerKeys.length || analysis.alreadySentToday) {
          summary.skipped += 1
          continue
        }

        const html = buildAlertHtml({
          email:sub.email,
          referenceDate:today,
          triggerKeys:analysis.triggerKeys,
          payload:analysis.payload,
          dashboardUrl,
        })

        await sendGmailHtml({
          to:sub.email,
          subject:config.subject,
          html,
          admin,
          config,
        })

        await persistDispatchLog(admin, {
          user_id:sub.user_id,
          email:sub.email,
          reference_date:today,
          risk_level:analysis.riskLevel,
          trigger_keys:analysis.triggerKeys,
          payload:analysis.payload,
          status:'sent',
        })

        await appendSheetsRow([
          new Date().toISOString(),
          today,
          sub.user_id,
          sub.email,
          analysis.riskLevel,
          analysis.triggerKeys.join(','),
          'sent',
          '',
        ], 'alerts_log', config)

        await appendSheetsRow([
          new Date().toISOString(),
          sub.user_id,
          sub.email,
          true,
        ], 'subscribers', config)

        summary.sent += 1
      } catch (error) {
        summary.failures += 1
        await persistDispatchLog(admin, {
          user_id:sub.user_id,
          email:sub.email,
          reference_date:today,
          risk_level:'error',
          trigger_keys:[],
          payload:{},
          status:'failed',
          error_message:error?.message || 'Erro ao enviar alerta',
        })
        await appendSheetsRow([
          new Date().toISOString(),
          today,
          sub.user_id,
          sub.email,
          'error',
          '',
          'failed',
          error?.message || 'Erro ao enviar alerta',
        ], 'alerts_log', config).catch(() => {})
      }
    }

    return res.status(200).json({ ok:true, referenceDate:today, ...summary })
  } catch (error) {
    return res.status(500).json({ error:error?.message || 'Erro interno ao processar alertas' })
  }
}
