# WhatsApp · Monitoramento + escopo por usuário

> Fase 2 (comunicação). Segue o padrão da seção 7 da spec de arquitetura. Spec primeiro; mockup;
> implementação depois da aprovação. **Decidido com Felipe (13/10/2026):** construir o monitoramento
> "de verdade" — hoje o inbox é compartilhado (todos veem tudo), o que é mais aberto que a regra da clínica.

## 1. Goal
Cada pessoa da equipe vê **apenas as conversas de WhatsApp dos números que são dela**; o **admin
(Dra. Vitória/Augusto) monitora todas**, com visão por pessoa. Fecha a regra de acesso que a clínica
definiu e que hoje não existe no dado.

## 2. Contexto do cliente
Tabela de permissões (CLAUDE.md): *WhatsApp — uso:* admin/gestão/equipe ✅; *WhatsApp —
monitoramento e configuração:* **admin ✅, gestão ❌, equipe ❌**. Nota: "todos usam, mas apenas
Vitória e Augusto podem ver as conversas dos outros". Hoje a RLS é por clínica (`data_owner_id()`) e
o schema diz explicitamente que o membro lê as mensagens do dono "não só as próprias" → **todos veem
tudo**. Ver [[project_phase2_whatsapp_oct2026]] e [[project_meeting_vitoria_oct2026]].

## 3. Área e lugar na navegação
Área **CRM/Comercial → WhatsApp** (inbox já existente, `WhatsAppInbox.jsx`). O monitoramento é um
modo/filtro dentro do próprio inbox para o admin; não é tela nova. Atribuição de número↔usuário entra
em **Configurações → WhatsApp** (só admin).

## 4. Benchmark e o que copiar
Kommo/stage de atendimento: caixa de entrada compartilhada **com responsável por conversa** e visão
de supervisor. Copiar: **dono da conversa visível no card** + **filtro "responsável"** para o admin.

## 5. Fluxo ideal
- **Equipe/Gestão:** abre WhatsApp e vê só as conversas dos **números atribuídos a ela**. Sem filtro de
  pessoa. Número não atribuído não aparece.
- **Admin:** vê **todas**; tem um filtro **"Responsável: Todos ▾"** (por pessoa) somando ao filtro de
  número que já existe; cada conversa mostra um **chip com o dono** (ex.: "Jonas"); vê as **não
  atribuídas** destacadas para encaminhar.
- **Admin em Configurações → WhatsApp:** para cada número, escolhe o **responsável** (um usuário da
  equipe). Número sem responsável = visível só para admin.

## 6. Modelo de dados e propagação

### 6.1 Campos
- **`whatsapp_numbers.assigned_user_id`** (uuid, nullable, FK `auth.users`) — o dono do número.
- Nada muda em `whatsapp_messages` (a conversa herda o dono pelo `whatsapp_number_id`).

### 6.2 Enforcement (RLS real, não só no menu)
Hoje a policy de `whatsapp_messages` é `user_id = data_owner_id()`. Passa a:
```
user_id = public.data_owner_id() AND (
  public.is_clinic_admin()                      -- admin vê/monitora tudo
  OR whatsapp_number_id IN (                     -- os demais: só os números deles
       select id from public.whatsapp_numbers
       where assigned_user_id = auth.uid()
  )
)
```
- Nova função `public.is_clinic_admin()` (lê o `role` do `clinic_members` para `auth.uid()`), **security
  definer**. É a **primeira RLS por perfil do app** (o resto gateia só no nav) — decisão consciente,
  por ser dado sensível (conversa de paciente). O envio (`?action=message`) valida o mesmo no servidor.
- `whatsapp_numbers`: leitura de todos os números continua liberada (para montar filtros), mas o
  `assigned_user_id` só é gravável por admin.

### 6.3 Mapa de propagação
| Toca | Afeta | Garantia |
|------|-------|----------|
| `assigned_user_id` do número | o que cada usuário enxerga no inbox | RLS deriva do dono; sem dono = só admin |
| RLS de `whatsapp_messages` | inbox, chat do paciente (aba WhatsApp em Pacientes), automações | automações rodam no **service_role** (não afetadas); só a visão do usuário muda |
| envio de mensagem | equipe só envia pelos números dela | checado no servidor (`api/whatsapp.js?action=message`) |

## 7. Pontos de integração/automação
- **Automações/cron** usam `service_role` → continuam vendo tudo (não dependem da RLS do usuário).
- **Aba WhatsApp do paciente** (`WhatsAppChat`) passa a respeitar o mesmo escopo.

## 8. Permissões
- **Monitorar (ver todas + filtro por pessoa):** admin.
- **Ver as próprias:** gestão, equipe, concierge (pelos números atribuídos).
- **Atribuir número↔usuário / configurar:** admin.

## 9. Mapa de arquivos
**Criar:** `supabase/whatsapp_ownership_schema.sql` (coluna + `is_clinic_admin()` + nova policy + grants).
**Editar:** `WhatsAppInbox.jsx` (filtro "responsável" p/ admin + chip de dono), `WhatsAppConfig`/Settings
(atribuir responsável por número), `api/whatsapp.js` (validar número↔usuário no envio),
`WhatsAppChat.jsx` (herda escopo), `CHANGELOG.md`. Testes unit/e2e.

## 10. Tasks
1. SQL: `assigned_user_id` + `is_clinic_admin()` + nova policy de `whatsapp_messages` + grant de update do assigned.
2. Config: UI de atribuir responsável por número (admin).
3. Inbox: chip de dono + filtro "Responsável" (admin); equipe sem o filtro.
4. Envio: validar no servidor que o número é do usuário (ou admin).
5. Testes (RLS por perfil; filtro; envio bloqueado fora do escopo). CHANGELOG.

## 11. Checklist de fidedignidade
1. **Equipe não lê conversa de número que não é dela** (testar via RLS, não só via UI).
2. **Admin vê tudo**, inclusive não atribuídas; gestão NÃO monitora (vê só as dela).
3. **Automações não quebram** (rodam em service_role).
4. **Envio escopado**: equipe não envia por número de outro.
5. Número sem `assigned_user_id` → visível só para admin (nunca "vaza" para equipe).

## 12. Testes e aceitação
- Unit: lógica de "pode ver/enviar neste número?" (pura). E2e: admin vê filtro de responsável + chips;
  equipe vê inbox reduzido. Teste de RLS por perfil.
- `CHANGELOG.md` no mesmo commit.

## Endurecimento pós code-review (13/10/2026)
- **Escrita de `whatsapp_numbers` só admin** (`is_clinic_admin()` na policy de escrita) — senão equipe
  se auto-atribuía um número via supabase-js e lia tudo (brecha crítica). SELECT escopado também:
  equipe/gestão só enxergam os números delas (não vazam os dos outros nem dão 403 ao responder).
- **Roster via RPC `clinic_team()`** (security definer) — um admin que não é owner (Augusto) e o uso
  do time no inbox/config dependem de enxergar todos os membros; o SELECT normal de `clinic_members`
  só devolve a própria linha para não-owner.
- **Mensagens sem número** (legadas / número removido) continuam **visíveis à clínica** (como antes) —
  o escopo por número vale para conversas com número; assim não some histórico silenciosamente.
- **`whatsapp_messages` vira SELECT-only para o front**; escrita só pelo service_role (endpoint/automação).

## Decisões (fechadas com Felipe, 13/10/2026)
- **D1 · Dono por NÚMERO.** ✅ Confirmado.
- **D2 · Só ADMIN monitora** (Augusto + Dra. Vitória). ✅ Gestão NÃO monitora — vê só as conversas
  dos números dela, igual à equipe. `is_clinic_admin()` cobre apenas `role='admin'`.
- **D3 · Um dono por número** no MVP. ✅ Vários responsáveis por número fica para depois.
