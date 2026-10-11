# WhatsApp — Inbox central + Multi-número (Fase 2, sub-projeto 3) — Design

> Alinha à spec de arquitetura (seção 4: "WhatsApp (inbox)" em Pacientes; "WhatsApp (monitoramento+config)" em Automações). Evolui o WhatsApp atual (single-number, chat por paciente) para 3 números + inbox central. Aprovado por Felipe (10/10/2026).

## Objetivo
Dar uma **inbox central** de WhatsApp (todas as conversas numa tela, estilo Chatwoot/Kommo), suportando os **3 números de WhatsApp Business** da clínica, mostrando inclusive conversas **não atribuídas** (lead novo que chama no zap) — hoje elas somem. Deixar as **credenciais prontas-pra-plugar** (admin cadastra número + credencial na tela e funciona).

## Decisões
- **Inbox** fica em Pacientes → seção **CRM & Jornada** (novo item "WhatsApp"). Todos usam.
- **Gerenciar números + credenciais** fica no **admin** (área Automações & Integrações).
- A **aba WhatsApp dentro do paciente** (já existe) permanece — visão focada de 1 contato. "Um dado, várias portas".
- Credenciais Z-API ficam **no servidor** (tabela, lidas via service role) — nunca no frontend.
- Sem função serverless nova — estende `api/whatsapp.js` (continua 12/12 no Hobby).

## Dados (multi-número)
```
whatsapp_numbers
  id, user_id (owner/clínica),
  label text,            -- "Concierge" | "Secretaria" | "Dra."
  phone text,            -- número da linha (só dígitos)
  active boolean,
  instance_url text,     -- Z-API: https://api.z-api.io/instances/{id}/token/{token}   [SECRETO]
  api_token text,        -- Client-Token Z-API                                          [SECRETO]
  webhook_secret text,   -- token do webhook deste número
  created_at

whatsapp_messages  (+ coluna)
  + whatsapp_number_id uuid  -- de/por qual número
```
- **Segurança das credenciais:** colunas secretas (`instance_url`, `api_token`, `webhook_secret`) com GRANT revogado do papel `authenticated` (frontend não lê nem selecionando); o endpoint usa **service role**. Metadados (`id,label,phone,active`) ficam legíveis pela clínica (`data_owner_id()`), para o seletor e a inbox.
- RLS de `whatsapp_numbers`: SELECT/gerência só admin (dono); leitura de metadados pela clínica via view ou colunas liberadas.

## Back-end (estende `api/whatsapp.js`)
- **Webhook por número:** `/api/whatsapp?action=webhook&number=<id>&token=<secret>`. O servidor valida o `webhook_secret` do número, descobre o `owner` e o `whatsapp_number_id`, casa telefone→paciente (como hoje, estrito) e grava com idempotência. Substitui o `WHATSAPP_OWNER_USER_ID` por env.
- **Enviar:** body inclui `whatsappNumberId`. O servidor lê as credenciais **daquele número** (service role) e envia. Substitui `WHATSAPP_API_URL/KEY` por env.
- `whatsappClient.sendWhatsAppText(instanceUrl, apiToken, phone, text)` — recebe a config por parâmetro, não mais de env.

## Front-end
**Inbox central** (`WhatsAppInbox.jsx`, item "WhatsApp" em CRM & Jornada):
- Lista de conversas agrupadas por (número + telefone): nome do paciente ou número cru, prévia, horário, **selo do número**, não-lida, **⚠ não atribuída**.
- Filtro por número (Todos / cada label).
- Thread + responder; **"Responder por [número]"** (default = número da conversa).
- Não atribuída → ação **vincular a paciente existente / cadastrar na hora**.

**Config de números** (admin, área Automações): CRUD de números (label, phone, instance_url, api_token), mostra a **URL de webhook** pronta pra colar no Z-API, botão testar.

## Fidedignidade (checklist)
1. Webhook idempotente por número (índice único já cobre `provider_message_id`; escopo por número).
2. Inbound atribuído ao **número certo** (via `?number=<id>` + validação do `webhook_secret`).
3. Telefone→paciente estrito (ambíguo/novo → não atribuída, nunca paciente errado).
4. Credenciais nunca expostas ao frontend (GRANT + service role).
5. Enviar usa o número escolhido; a mensagem gravada registra `whatsapp_number_id`.
6. RLS multi-tenant: clínica só vê suas conversas/números.

## Incrementos
3a. `whatsapp_numbers` + `whatsapp_number_id` (SQL) · endpoint multi-número (webhook/send por número) · client por parâmetro · **tela admin de números** (cadastrar/credencial/webhook URL).
3b. **Inbox central** (lista + thread + responder + filtro + não atribuídas + vincular/cadastrar).

## Fora do escopo
- Templates aprovados / Salesbot (vêm no motor de automação, sub-projeto 4).
- Atribuição de conversa por usuário (números são compartilhados; refinamento posterior).
- Mídia (áudio/imagem) — por ora só texto.
