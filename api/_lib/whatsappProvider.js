import {
  configureZApiReceiveWebhook,
  enableZApiSentByMe,
  listZApiChats,
  resolveZApiPhoneLids,
  sendWhatsAppMedia,
  sendWhatsAppText,
  testWhatsAppConnection,
} from './whatsappClient.js'
import {
  configureEvolutionWebhook,
  connectEvolutionInstance,
  createEvolutionInstance,
  downloadEvolutionMedia,
  getEvolutionConnection,
  listEvolutionChats,
  resolveEvolutionPhoneLids,
  sendEvolutionMedia,
  sendEvolutionText,
} from './evolutionClient.js'

export function whatsappProvider(number) {
  return number?.provider === 'evolution' ? 'evolution' : 'zapi'
}

export function providerReady(number) {
  return whatsappProvider(number) === 'evolution'
    ? Boolean(number?.provider_instance_name)
    : Boolean(number?.instance_url && number?.api_token)
}

export async function testProviderConnection(number) {
  if (whatsappProvider(number) === 'evolution') {
    const result = await getEvolutionConnection(number.provider_instance_name)
    if (!result.connected) throw new Error(`A instância Evolution está ${result.state === 'connecting' ? 'aguardando conexão' : 'desconectada'}.`)
    return result
  }
  return testWhatsAppConnection(number.instance_url, number.api_token)
}

export async function configureProviderWebhook(number, webhookUrl) {
  if (whatsappProvider(number) === 'evolution') {
    return configureEvolutionWebhook(number.provider_instance_name, webhookUrl, number.webhook_secret)
  }
  const connection = await testWhatsAppConnection(number.instance_url, number.api_token)
  await enableZApiSentByMe(connection.instanceUrl, number.api_token)
  return configureZApiReceiveWebhook(connection.instanceUrl, number.api_token, webhookUrl)
}

export async function sendProviderText(number, to, text) {
  return whatsappProvider(number) === 'evolution'
    ? sendEvolutionText(number.provider_instance_name, to, text)
    : sendWhatsAppText(number.instance_url, number.api_token, to, text)
}

export async function sendProviderMedia(number, type, args) {
  return whatsappProvider(number) === 'evolution'
    ? sendEvolutionMedia(number.provider_instance_name, type, args)
    : sendWhatsAppMedia(number.instance_url, number.api_token, type, args)
}

export async function listProviderChats(number) {
  return whatsappProvider(number) === 'evolution'
    ? listEvolutionChats(number.provider_instance_name)
    : listZApiChats(number.instance_url, number.api_token)
}

export async function resolveProviderPhoneLids(number, phones, options) {
  return whatsappProvider(number) === 'evolution'
    ? resolveEvolutionPhoneLids(number.provider_instance_name, phones, options)
    : resolveZApiPhoneLids(number.instance_url, number.api_token, phones)
}

export async function downloadProviderMedia(number, message) {
  if (whatsappProvider(number) !== 'evolution') throw new Error('Download de mídia não disponível para este provedor.')
  return downloadEvolutionMedia(number.provider_instance_name, message)
}

export { createEvolutionInstance, connectEvolutionInstance, getEvolutionConnection }
