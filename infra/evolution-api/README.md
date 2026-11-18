# Evolution API com correção do stream do WhatsApp

Esta imagem mantém a Evolution API `v2.3.7` e aplica o backport do ack de
stanzas `status` da Baileys `7.0.0-rc.9`. Ele corrige o cenário em que a
instância permanece `open`, mas deixa de entregar mensagens e webhooks depois
de um `stream errored out`.

## Railway

1. O workflow `.github/workflows/evolution-api-image.yml` publica a imagem em:
   `ghcr.io/felipedalpra/fintech/evolution-api:latest`.
2. No serviço da Evolution, abra `Settings`, encontre `Source Image`, clique no
   lápis e troque somente a imagem para esse endereço.
3. Mantenha as variáveis atuais do serviço, principalmente conexão do banco,
   Redis, chave global e configurações de autenticação.
4. Faça o deploy primeiro com um número de homologação.
5. Valide recebimento, envio, grupo, áudio, imagem e documento. Observe os
   logs por pelo menos uma hora e confirme que não surgem novos `stream errored
   out` relacionados a `ack`/`status`.
6. Depois do teste, promova o mesmo build para produção.

Na primeira publicação, o pacote do GHCR precisa estar público ou o Railway
precisa receber credenciais de um registry privado. A imagem não contém
segredos; ela contém apenas a Evolution base e o patch da Baileys.

O script aborta se a imagem base não contiver exatamente a Baileys
`7.0.0-rc.9` ou se o arquivo alvo tiver mudado. Isso evita aplicar um patch
silenciosamente incompatível depois de uma atualização da imagem base.

Não use `2.4.0-rc2` em produção como substituição direta: é uma release
candidate e possui mudanças de ativação/licenciamento e migração próprias.
