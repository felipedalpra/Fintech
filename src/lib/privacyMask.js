// Máscaras do modo apresentação: trocam dado pessoal por pontinhos para gravar vídeo,
// demonstrar a plataforma ou trabalhar em lugar público.
//
// Duas regras que valem para todas as funções daqui:
//
// 1. Mascarar é SÓ exibição. Nada aqui toca o dado guardado — o modo é um filtro na hora de
//    pintar a tela. Desligar o modo devolve o valor original porque ele nunca saiu do lugar.
// 2. Ausente continua ausente. Mascarar `null` produziria pontinhos onde não há dado, ou seja,
//    inventaria na tela um valor que não existe. Vazio entra, vazio sai.

const PONTO = '•'
const MAX = 10

const vazio = v => v === null || v === undefined || String(v).trim() === ''

/** Já mascarado? Então não mascara de novo — senão cada passagem aumentaria a fileira. */
function jaMascarado(texto) {
  return texto.length > 0 && [...texto].every(c => c === PONTO || c === ' ' || '()-@.'.includes(c))
}

function pontos(n) {
  return PONTO.repeat(Math.max(1, Math.min(n, MAX)))
}

/**
 * Nome de pessoa (paciente, membro da equipe, lead). Preserva a quantidade de palavras e,
 * até um limite, o tamanho de cada uma: assim a linha não muda de largura ao ligar o modo,
 * e a tela continua legível como "aqui vai um nome".
 */
export function maskName(value) {
  if (vazio(value)) return ''
  const texto = String(value).trim()
  if (jaMascarado(texto)) return texto
  return texto.split(/\s+/).map(p => pontos(p.length)).join(' ')
}

/** E-mail inteiro, domínio incluído: só o domínio já identifica a clínica. */
export function maskEmail(value) {
  if (vazio(value)) return ''
  const texto = String(value).trim()
  if (jaMascarado(texto)) return texto
  return `${pontos(6)}@${pontos(5)}`
}

/** Telefone com o formato preservado e nenhum dígito real. */
export function maskPhone(value) {
  if (vazio(value)) return ''
  const texto = String(value).trim()
  if (jaMascarado(texto)) return texto
  return `(${PONTO.repeat(2)}) ${PONTO.repeat(5)}-${PONTO.repeat(4)}`
}

/** Dinheiro. Mantém o "R$" para a linha continuar lendo como valor. */
export function maskMoney() {
  return `R$ ${PONTO.repeat(5)}`
}

/**
 * Texto livre — corpo de mensagem, observação, anotação clínica. Não dá para preservar
 * forma alguma com segurança: qualquer pedaço mantido pode ser justamente o dado sensível.
 */
export function maskText(value) {
  if (vazio(value)) return ''
  const texto = String(value).trim()
  if (jaMascarado(texto)) return texto
  return PONTO.repeat(Math.min(texto.length, 24))
}
