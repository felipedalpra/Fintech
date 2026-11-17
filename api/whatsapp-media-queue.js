import { processWhatsAppMediaQueue } from './whatsapp.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error:'Method not allowed' })
  const secret = process.env.CRON_SECRET || process.env.VERCEL_CRON_SECRET
  const headerSecret = req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || ''
  const bearer = (req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
  if (!secret || (headerSecret !== secret && bearer !== secret)) return res.status(401).json({ error:'Invalid cron secret' })
  try {
    const summary = await processWhatsAppMediaQueue({ limit:req.query?.limit })
    return res.status(200).json({ ok:true, ...summary })
  } catch (error) {
    console.error('whatsapp media queue error:', error?.message)
    return res.status(500).json({ error:'WhatsApp media queue failed' })
  }
}
