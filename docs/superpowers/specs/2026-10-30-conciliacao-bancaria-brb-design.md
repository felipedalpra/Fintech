# Conciliação bancária — extrato BRB

## Estado

Levantado em **30/10/2026** a partir de um extrato real de outubro/2026 da conta
PJ da clínica no **BRB**.

**Nenhum dado real foi copiado para este documento.** Os exemplos são
ilustrativos: o extrato original tem nomes de pacientes e valores reais e não
entra no repositório.

## Como o PDF é lido

O texto do PDF **não está na ordem de leitura**: a coluna `Histórico` vem num
bloco e a coluna `Dia`/`Valor` em outro. Copiar e colar embaralha os campos.

Por isso o PDF é lido pela **posição** de cada fragmento
(`src/lib/pdfTextRows.js`): os fragmentos são agrupados em linhas pela
coordenada vertical, com tolerância proporcional ao tamanho do texto, e
ordenados pela horizontal. O resultado é a linha remontada —
`01/10 | CREDITO PIX – DOC: 000000 | R$ +1.234,00` — que então passa pelo
parser do layout.

O `pdf.js` é carregado **sob demanda**: quem nunca importa um PDF não paga o
peso dele. O arquivo bruto é lido no navegador e não é enviado nem guardado,
como já valia para OFX e CSV.

PDF digitalizado (imagem, sem texto selecionável) é recusado com explicação, em
vez de importar nada.

## Formato do extrato

PDF gerado pelo internet banking, organizado em **duas seções por mês**:

```
OUTUBRO/2026
ENTRADAS
  Dia | Histórico | Valor
SAÍDAS
  Dia | Histórico | Valor
```

Cada linha tem três campos:

| Campo | Formato | Exemplo ilustrativo |
| --- | --- | --- |
| `Dia` | `DD/MM`, **sem ano** | `01/10` |
| `Histórico` | tipo + `– DOC: NNNNNN`; numa segunda linha, contraparte + código de canal | `CREDITO PIX – DOC: 000000` / `FULANO DE TAL — 0136` |
| `Valor` | `R$ +0.000,00` / `R$ −0.000,00` | `R$ +1.234,00` |

### Tipos observados

**Entradas:** `CREDITO PIX`, `CRED PIX INTERNO`, `CREDITO DE TED PAG C.CORRENTE`,
`CRED JUROS LIQUIDO CDB AUTOMAT`.

**Saídas:** `DEBITO PIX`, `TARIFA ENVIO VALORES PIX`, `DEBITO COBRANCA OUTRO BANCO`,
`PAGAMENTO COBRANCA BRB`, `PAGAMENTO TRIBUTO FEDERAL`, `PAGAMENTO VIVO DF`,
`PACOTE EMPREENDEDOR`.

## As quatro dificuldades que decidem o desenho

### 1. Não existe identificador único de transação

`DOC` vem **`000000`** em praticamente toda linha PIX. Só TED, cobrança e
tributo trazem número de verdade.

Consequência: **o DOC não serve como chave de idempotência.** A chave é derivada
de `(data, direção, valor, tipo, contraparte normalizada)` mais um **índice de
ocorrência** dentro do mesmo dia — porque duas transferências idênticas no mesmo
dia são indistinguíveis no extrato e as duas são legítimas.

### 2. O ano não está na linha

`Dia` é só `DD/MM`; o ano vem do cabeçalho da seção. Precisa ser propagado. Um
extrato que cruze a virada do ano tem mais de uma seção, e assumir "ano atual"
geraria lançamento com data errada.

### 3. Nome da contraparte vem truncado

Cortado em ~20 caracteres (`DAGMA LUISA DE QUEIR`), às vezes com CPF/CNPJ
parcial colado. **Não dá para casar por nome exato.** O nome é sinal auxiliar,
nunca critério suficiente, e o resultado é **sugestão revisável** — pela regra de
fidedignidade do projeto, dado errado é pior que dado nenhum.

### 4. Não há saldo

Sem saldo inicial, final ou corrente, **não existe soma de controle** para
provar que a importação pegou todas as linhas. A conferência é por contagem e
total por seção, exibidos para o humano confirmar.

## Como conversa com o que já existe

- a importação retroativa de planilha (`financial_import_batches` /
  `financial_import_lines`, 29/10/2026) já resolveu o padrão
  **arquivo → lote persistido → revisão linha a linha → confirmação**. A
  conciliação reusa o desenho, com tabelas próprias porque o objetivo é
  diferente: ali se **cria** lançamento, aqui se **casa** com o que já existe;
- o modelo de três datas vale: o extrato é **data de caixa**. Conciliar nunca
  reescreve a competência de um lançamento;
- conciliar aponta para o lançamento existente; não cria um paralelo.

## Perguntas a fechar com o Felipe

1. O BRB exporta **OFX ou CSV**? O PDF já funciona, mas OFX seria melhor: tem
   `FITID`, o identificador único que falta no PDF.
2. Linha sem par no sistema: vira lançamento novo, ou só fica sinalizada?
3. Tarifa e juros de CDB viram despesa/receita financeira automática?
4. Quem revisa: só a Dra. Vitória e a Lunara, ou o Jonas também?
