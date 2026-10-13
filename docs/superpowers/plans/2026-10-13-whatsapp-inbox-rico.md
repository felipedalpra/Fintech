# WhatsApp · Inbox rico (emoji, áudio, imagem, documento)

> Fase 2 (comunicação). Companheira de [[2026-10-13-whatsapp-monitoramento]]. Pedido do Felipe
> (13/10/2026): o inbox tem que ser "como um WhatsApp de verdade" — mandar emoji, áudio/voz, imagem e
> documento, com player e miniatura. Spec + mockup antes de codar. Mockup:
> https://claude.ai/artifact/KdXFtifNqZFJtwas2W4Cty

## 1. Goal
Conversar pela plataforma com a mesma riqueza do WhatsApp: **emoji, áudio (voz/PTT), imagem e
documento**, enviando e recebendo, com player de áudio, miniatura de imagem e confirmação de
entrega/leitura (✓✓). Hoje a plataforma só manda/recebe **texto**.

## 2. Contexto do cliente
A clínica atende leads/pacientes majoritariamente por áudio e foto no WhatsApp. Um inbox só-texto
força a equipe a voltar pro app do WhatsApp — quebra a proposta de centralizar. Ver
[[project_phase2_whatsapp_oct2026]].

## 3. Estado atual (o que falta)
- Envio: `api/_lib/whatsappClient.js` só tem `sendWhatsAppText` (`/send-text`).
- Recebimento: `parseIncomingMessage` só extrai texto e **descarta** mensagens sem texto
  (`if (!phone || !text) return null`) → áudio/imagem que chegam hoje são **perdidos**.
- Banco: `whatsapp_messages` guarda `body`/`direction`/`status`, sem tipo nem mídia.
- **A Z-API suporta** `send-image`, `send-audio`/PTT, `send-document`, `send-video`, e entrega os
  links de mídia recebida no webhook. Então é viável — é implementação, não limitação de infra.

## 4. Benchmark e o que copiar
WhatsApp Web / Kommo: composer com emoji + anexo + microfone; balões de áudio com waveform+player,
imagem com miniatura, documento com ícone/nome/tamanho; ✓✓ de leitura. Copiar esse conjunto.

## 5. Fluxo ideal
- **Receber:** chega áudio/imagem/documento → webhook salva tipo + URL da mídia (hospedada pela
  Z-API) → aparece no balão como player / miniatura / card de documento.
- **Enviar emoji:** seletor no composer; vai como texto (`send-text`) — já funciona no backend.
- **Enviar imagem/documento:** botão 📎 → escolhe arquivo → preview → envia.
- **Enviar áudio:** botão 🎤 → grava no navegador (MediaRecorder) → preview → envia como voz (PTT).
- **Status:** ✓ enviado, ✓✓ entregue/lido, refletido no balão a partir do `status`.

## 6. Modelo de dados e propagação
- **`whatsapp_messages`** ganha: `msg_type` ('text'|'image'|'audio'|'document'|'video', default 'text'),
  `media_url` (text), `media_mime` (text), `caption` (text). Migração aditiva (`whatsapp_media_schema.sql`).
- Retrocompat: linhas antigas = `text`. As automações (service_role) continuam mandando texto.
- **Propagação:** o mesmo balão aparece no inbox e na aba WhatsApp do paciente; a mídia recebida é
  referência à URL da Z-API (não rearmazenamos a de entrada). A de **saída** (áudio gravado, imagem
  anexada) precisa de um lugar público para a Z-API buscar — ver seção 7.

## 7. Pontos de integração/decisão técnica
- **Envio de mídia pela Z-API:** `send-image`/`send-document`/`send-audio` aceitam **URL** ou
  **base64**. Decisão (D1): tentar **base64 direto** do navegador → nosso endpoint → Z-API, sem
  bucket próprio. Se a Z-API exigir URL p/ áudio, usar **Supabase Storage** (bucket privado
  `wa-media`, URL assinada). Começar por base64; cair pra Storage só se necessário.
- **Gravação de áudio:** `MediaRecorder` no navegador (permissão de microfone); exporta webm/opus →
  enviar como PTT. É a peça mais pesada do front.
- **Endpoint:** estender `api/whatsapp.js?action=message` para aceitar `{ type, mediaBase64|mediaUrl,
  caption }` e rotear pro envio certo — **sem função serverless nova** (Hobby 12/12).
- **Webhook:** `parseIncomingMessage` passa a reconhecer os formatos de mídia da Z-API e devolver
  `{ msg_type, media_url, media_mime, caption, text? }`.

## 8. Permissões
Mesmas do uso de WhatsApp (todos enviam/recebem), respeitando o escopo por número da spec de
monitoramento. Sem distinção nova por tipo de mídia.

## 9. Mapa de arquivos
**Criar:** `supabase/whatsapp_media_schema.sql`; componentes de UI (EmojiPicker, AudioRecorder, bolhas
de mídia) dentro de `WhatsAppInbox.jsx`/`WhatsAppChat.jsx`.
**Editar:** `api/_lib/whatsappClient.js` (sendImage/sendDocument/sendAudio), `api/_lib/whatsapp.js`
(parse de mídia no recebido), `api/whatsapp.js` (`?action=message` com mídia), `WhatsAppInbox.jsx` e
`WhatsAppChat.jsx` (composer rico + render de mídia), `CHANGELOG.md`. Testes.

## 10. Tasks (faseado dentro de B)
**B1 — receber mídia + emoji (menor risco):**
1. SQL `whatsapp_media_schema.sql` (colunas de tipo/mídia).
2. `parseIncomingMessage` reconhece imagem/áudio/documento (+ testes puros).
3. Render dos balões (player de áudio, miniatura de imagem, card de documento).
4. Seletor de emoji no composer (envio por texto, já suportado).

**B2 — enviar mídia:**
5. `whatsappClient`: `sendWhatsAppMedia` (image/document/audio) via base64→Z-API.
6. `?action=message` aceita mídia; validação de tamanho/tipo.
7. Anexo (📎 imagem/documento) + gravador de áudio (🎤 MediaRecorder) no composer.
8. Testes + CHANGELOG.

## 11. Checklist de fidedignidade
1. Mídia recebida nunca é perdida (webhook não descarta mais não-texto).
2. Tipo e URL corretos por mensagem; linha antiga continua válida como `text`.
3. Envio respeita o **escopo por número** (não burla a spec de monitoramento).
4. Limite de tamanho de upload (ex.: imagem/doc ≤ alguns MB; áudio curto) — erro claro, sem 500.
5. Sem segredo/credencial no cliente; mídia de saída só via endpoint autenticado.

## 12. Testes e aceitação
- Unit: `parseIncomingMessage` para cada tipo de mídia (puro). Lógica de montar o payload de envio.
- E2e: balão de áudio/imagem/documento renderiza; composer mostra emoji/anexo/microfone; envio de
  texto+emoji funciona (mídia real só valida em preview Vercel com Z-API).
- `CHANGELOG.md` no mesmo commit.

## Decisões / ordem
- **Sequência recomendada:** (A) monitoramento/escopo → (B1) receber mídia + emoji → (B2) enviar
  mídia/áudio. Cada um em branch/PR próprio. A é a menor e já aprovada; estabelece o modelo por
  usuário sobre o qual o inbox rico é construído.
- **D1 (storage de saída):** base64→Z-API primeiro; Supabase Storage só se a Z-API exigir URL.
- **A confirmar:** gravação de áudio no navegador (🎤) entra já no B2 — é a peça mais pesada do front.
