# Evolution API com correção do stream do WhatsApp

Esta imagem mantém a Evolution API `v2.3.7` e aplica o backport do ack de
stanzas `status` da Baileys `7.0.0-rc.9`. Ele corrige o cenário em que a
instância permanece `open`, mas deixa de entregar mensagens e webhooks depois
de um `stream errored out`.

## Railway

1. Faça backup do PostgreSQL e confirme que PostgreSQL e Redis são persistentes.
2. No serviço da Evolution, use o repositório desta aplicação como origem e
   configure o caminho do Dockerfile como `infra/evolution-api/Dockerfile`.
3. Mantenha as variáveis atuais do serviço, principalmente conexão do banco,
   Redis, chave global e configurações de autenticação.
4. Faça o deploy primeiro com um número de homologação.
5. Valide recebimento, envio, grupo, áudio, imagem e documento. Observe os
   logs por pelo menos uma hora e confirme que não surgem novos `stream errored
   out` relacionados a `ack`/`status`.
6. Depois do teste, promova o mesmo build para produção.

O script aborta se a imagem base não contiver exatamente a Baileys
`7.0.0-rc.9` ou se o arquivo alvo tiver mudado. Isso evita aplicar um patch
silenciosamente incompatível depois de uma atualização da imagem base.

Não use `2.4.0-rc2` em produção como substituição direta: é uma release
candidate e possui mudanças de ativação/licenciamento e migração próprias.
