// src/lib/pdfTextRows.js
// Reconstrucao de LINHAS a partir dos fragmentos de texto de um PDF.
//
// Por que isto existe: o extrato do BRB nao guarda o texto na ordem de leitura.
// A coluna "Historico" vem num bloco e a coluna "Dia/Valor" em outro, entao
// copiar e colar embaralha os campos. Lendo o PDF, cada fragmento vem com a sua
// posicao, e da para remontar a linha pela coordenada -- o que e mais confiavel
// que o copiar-colar, nao menos.
//
// A funcao de agrupamento e pura de proposito: ela e o risco real (juntar duas
// linhas vizinhas, ou partir uma linha em duas) e precisa de teste proprio, sem
// depender do pdf.js.

// Dois fragmentos pertencem a mesma linha quando a diferenca de altura e menor
// que uma fracao da altura do proprio texto. Usar a altura do texto, e nao um
// numero fixo, mantem o agrupamento correto quando o PDF mistura corpo e
// cabecalho em tamanhos diferentes.
const DEFAULT_TOLERANCE_RATIO = 0.5

export function groupTextItemsIntoRows(items, { toleranceRatio = DEFAULT_TOLERANCE_RATIO } = {}) {
  const usable = (items || [])
    .map(item => ({
      text:String(item?.text ?? ''),
      x:Number(item?.x) || 0,
      y:Number(item?.y) || 0,
      height:Number(item?.height) || 0,
    }))
    .filter(item => item.text.trim())

  if (usable.length === 0) return []

  // De cima para baixo. No PDF o eixo Y cresce para cima, entao a ordem de
  // leitura e Y decrescente.
  const ordered = [...usable].sort((a, b) => b.y - a.y || a.x - b.x)

  const rows = []
  let current = null
  for (const item of ordered) {
    const tolerance = Math.max(item.height, 1) * toleranceRatio
    if (current && Math.abs(current.y - item.y) <= tolerance) {
      current.items.push(item)
      // A linha fica ancorada no primeiro fragmento, para que uma sequencia de
      // fragmentos levemente inclinados nao va "escorregando" para a linha
      // seguinte.
      continue
    }
    current = { y:item.y, items:[item] }
    rows.push(current)
  }

  return rows.map(row => row.items
    .slice()
    .sort((a, b) => a.x - b.x)
    .map(item => item.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim())
    .filter(Boolean)
}

// O pdf.js 4.x usa Promise.withResolvers, que so existe no Node 22+ e no
// Safari 17.4+. Sem isto, importar um PDF quebraria para quem usa Safari um
// pouco mais antigo -- e falharia tambem nos testes.
function ensurePromiseWithResolvers() {
  if (typeof Promise.withResolvers === 'function') return
  Promise.withResolvers = function withResolvers() {
    let resolve
    let reject
    const promise = new Promise((resolveFn, rejectFn) => {
      resolve = resolveFn
      reject = rejectFn
    })
    return { promise, resolve, reject }
  }
}

// Duas razoes para copiar, nao referenciar:
//  - o pdf.js recusa um Buffer do Node, mesmo ele sendo um Uint8Array: precisa
//    de um Uint8Array "puro";
//  - o pdf.js TRANSFERE o buffer e o desanexa. Quem chamou ainda precisa dos
//    bytes (para calcular o hash do arquivo, por exemplo), e sem a copia isso
//    falha com "detached ArrayBuffer".
function toPlainBytes(source) {
  if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0))
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength))
  }
  return new Uint8Array(source)
}

// Le o PDF e devolve o texto ja remontado em linhas, pagina a pagina.
// O pdf.js e carregado sob demanda: quem nunca importa um PDF nao paga o peso
// dele no carregamento da aplicacao.
export async function extractPdfTextRows(buffer, { maxPages = 100 } = {}) {
  ensurePromiseWithResolvers()
  const pdfjs = await import('pdfjs-dist')
  // O pdf.js precisa de um worker. Em vez de servir um arquivo extra e
  // configurar caminho de build (que muda entre Vite e Node), importamos o
  // modulo do worker: ele se registra em globalThis.pdfjsWorker e o pdf.js o
  // encontra sozinho, rodando na mesma thread. O extrato tem poucas paginas,
  // entao nao vale a complexidade de um worker separado.
  if (!globalThis.pdfjsWorker) {
    globalThis.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs')
  }
  const task = pdfjs.getDocument({
    data:toPlainBytes(buffer),
    disableWorker:true,
    isEvalSupported:false,
    // O extrato e texto; nao precisamos de fontes externas nem de imagens.
    disableFontFace:true,
  })
  const document = await task.promise
  try {
    const pageCount = Math.min(document.numPages, maxPages)
    const rows = []
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const items = content.items
        .filter(item => typeof item.str === 'string')
        .map(item => ({
          text:item.str,
          // transform = [a, b, c, d, e, f]: e/f sao a posicao.
          x:item.transform[4],
          y:item.transform[5],
          height:Math.abs(item.transform[3]) || item.height || 0,
        }))
      rows.push(...groupTextItemsIntoRows(items))
      page.cleanup()
    }
    return rows
  } finally {
    await document.destroy()
  }
}

export async function extractPdfText(buffer, options = {}) {
  return (await extractPdfTextRows(buffer, options)).join('\n')
}
