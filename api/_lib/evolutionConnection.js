// api/_lib/evolutionConnection.js
// Lógica pura do ciclo de vida da conexão Evolution (webhook connection.update).
// Separado da orquestração (leitura/escrita no Supabase) pra ser testável sem mock de DB.

// Extrai o estado da conexão do payload connection.update da Evolution.
export function parseEvolutionConnectionState(body) {
  return String(body?.data?.state || body?.data?.status || body?.state || 'unknown').toLowerCase()
}

// Monta o patch de saúde/conexão a partir de um evento connection.update. NUNCA decide
// sozinho se há vaga pra reativar (isso depende de quantos outros números já estão
// ativos na clínica) — quem chama calcula `canActivate` e passa pronto.
export function buildConnectionHealthPatch(state, { now, wasActive, canActivate }) {
  const patch = { connection_state: state, last_health_at: now }
  if (state === 'open') {
    patch.connected_at = now
    if (!wasActive && canActivate) patch.active = true
  }
  return patch
}

// Decide se o webhook deve seguir para o processamento de mensagem/status/automação,
// ou parar por aqui. Conexão foi tratada antes desta checagem (sempre atualiza estado);
// isto só controla o restante — nunca processa mensagem de número que continua inativo.
export function shouldProcessWebhookPayload({ wasActive, reactivated }) {
  return Boolean(wasActive || reactivated)
}
