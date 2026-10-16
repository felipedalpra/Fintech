import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const PRIVATE_PREFIXES = ['storage://wa-media-inbound/', 'storage://wa-media/']
const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === 'true'

export function isPrivateWhatsAppMedia(url) {
  return PRIVATE_PREFIXES.some(prefix => String(url || '').startsWith(prefix))
}

async function accessToken() {
  if (E2E_BYPASS_AUTH) return 'e2e-token'
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || ''
}

async function requestSignedMediaUrl(messageId) {
  const token = await accessToken()
  if (!token) throw new Error('Sessão inválida. Entre novamente.')
  const response = await fetch('/api/whatsapp?action=media-url', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
    body:JSON.stringify({ messageId }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.url) throw new Error(data.error || 'Não foi possível abrir esta mídia.')
  return data.url
}

// URLs privadas duram cinco minutos. Enquanto a mensagem estiver visível,
// renova antes de expirar; mídias legadas/públicas continuam sem nova chamada.
export function WhatsAppMedia({ message, children, fallback = null }) {
  const privateMedia = isPrivateWhatsAppMedia(message?.media_url)
  const [url, setUrl] = useState(privateMedia ? '' : (message?.media_url || ''))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let refreshTimer
    if (!privateMedia) {
      setUrl(message?.media_url || '')
      setFailed(false)
      return () => { active = false }
    }
    const refresh = async () => {
      try {
        const signedUrl = await requestSignedMediaUrl(message.id)
        if (!active) return
        setUrl(signedUrl)
        setFailed(false)
        refreshTimer = setTimeout(refresh, 4 * 60 * 1000)
      } catch {
        if (active) setFailed(true)
      }
    }
    refresh()
    return () => {
      active = false
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [message?.id, message?.media_url, privateMedia])

  if (failed || !url) return fallback
  return children(url)
}
