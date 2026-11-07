// Estado da conexão com o Google Agenda, derivado da resposta da API.
//
// A distinção que este arquivo existe para manter: **"não configurado" e "deu erro" são
// coisas diferentes**. A tela esconde a barra do Google quando a clínica não tem a
// integração — comportamento certo. Mas tratar uma falha de rede ou um 500 como
// "não configurado" fazia o botão sumir sem dizer nada, e quem olhava a tela não tinha
// como saber se faltava permissão, faltava configuração ou se a requisição quebrou.

export const INITIAL_STATUS = {
  loading: true,
  configured: false,
  connected: false,
  needsReconnect: false,
  email: '',
  sharedByClinic: false,
  canManage: false,
  statusError: '',
}

export function statusFromResponse(next = {}) {
  return {
    loading: false,
    configured: Boolean(next.configured),
    connected: Boolean(next.connected),
    needsReconnect: Boolean(next.needsReconnect),
    email: next.email || '',
    sharedByClinic: Boolean(next.sharedByClinic),
    // Compatibilidade durante o deploy: a API antiga não enviava este campo e
    // permitia que qualquer usuário gerenciasse a própria conexão.
    canManage: next.canManage !== false,
    statusError: '',
  }
}

export function statusFromFailure(error) {
  const detalhe = (error && typeof error.message === 'string' ? error.message.trim() : '') || 'motivo não informado pelo servidor'
  return {
    ...INITIAL_STATUS,
    loading: false,
    statusError: `Não foi possível verificar a conexão com o Google Agenda: ${detalhe}`,
  }
}
