# Pendências da Clínica — SurgiMetrics

> Itens que precisam ser fornecidos ou decididos pela Dra. Vitoria / Augusto antes ou durante cada fase de implementação.
> Atualizado em: 2026-10-16

---

## 🔴 Bloqueantes — sem isso a feature não pode ser implementada

| # | Pendência | Feature bloqueada | Quem resolve |
|---|-----------|-------------------|--------------|
| 1 | **Decisão: gateway de pagamento vs. integração bancária direta** para emissão de boletos | Emissão de boletos | Dra. Vitoria / Augusto |
| 2 | **Ficha de anamnese atual** usada no Amigo (campos, estrutura, perguntas) | Anamnese digital | Dra. Vitoria |
| 3 | **Número de WhatsApp da clínica** conectado ao sistema (linha exclusiva recomendada) | WhatsApp CRM / Automações | Augusto |
| 4 | **Exportação dos cadastros do Amigo** (CSV ou outro formato) | Migração de pacientes | Augusto |

---

## 🟡 Necessários antes do deploy / go-live de cada feature

### Timbre para documentos (Pedido de Exames + Receituário + Prontuário)
- [ ] **Logo da clínica** — arquivo PNG ou SVG, fundo transparente
- [ ] **Nome completo** da Dra. Vitoria como aparece nos documentos clínicos
- [ ] **CRM** da Dra. Vitoria (número + UF, ex: CRM-SP 123456)
- [ ] **Endereço completo** da clínica (rua, número, bairro, cidade, CEP)
- [ ] **Telefone/contato** para constar no rodapé dos documentos

> Esses dados são configurados em Settings → Timbre e aparecem em todos os PDFs gerados.

---

### Pedido de Exames
- [ ] **Lista de exames** mais solicitados pela Dra. (hemograma, coagulação, ECG, etc.)
- [ ] **Kits pré-definidos** — ex: "Kit pré-operatório" com quais exames? "Kit cardio"? Quais outros kits usa com frequência?

---

### Receituário
- [ ] **Lista de medicamentos** mais prescritos (nome comercial ou princípio ativo)
- [ ] **Posologia padrão** de cada medicamento (ex: Dipirona 500mg — 1 comprimido de 8/8h por 3 dias)
- [ ] Confirmar que **receitas de controle especial (azul/amarela) estão fora do escopo** ← já acordado, confirmar se permanece assim

---

### WhatsApp CRM e Automações (Fase 2)
- [x] **Provedor de WhatsApp escolhido** — Evolution API self-hosted, com Z-API temporariamente disponível para rollback. ✅ 2026-10-16

#### O que Felipe / cliente precisa providenciar

- [ ] **Contratar ou confirmar a VPS HostGator NVMe 4** na região Brasil, com Ubuntu 22.04 e sem cPanel
- [ ] **Fornecer o acesso administrativo à VPS por canal seguro**: IP público, usuário SSH e cadastro de uma chave pública autorizada; nunca enviar chave privada nem registrá-la neste repositório
- [ ] **Dar acesso ao DNS de `surgimetrics.com.br` ou criar o registro A** de `evolution.surgimetrics.com.br` apontando para o IP da VPS
- [ ] **Confirmar acesso ao projeto correto da Vercel**, para que as variáveis server-side sejam configuradas sem compartilhar token no código ou na documentação
- [ ] **Aplicar no Supabase o novo SQL** `supabase/whatsapp_evolution_provider_schema.sql`
- [ ] **Confirmar que `supabase/whatsapp_media_storage.sql` já foi aplicado**; se não foi, executá-lo antes da homologação de anexos
- [ ] **Separar o número de homologação** com WhatsApp Business ativo, celular disponível e responsável presente para ler o QR Code em “Dispositivos conectados”
- [ ] **Definir contatos de teste autorizados** para validar texto, áudio, imagem, documento, grupos e mensagens enviadas diretamente pelo celular
- [ ] **Informar qual será o número definitivo da clínica** depois da homologação
- [ ] **Escolher uma janela de migração** em que a equipe possa acompanhar o primeiro acesso, reconexões e mensagens em tempo real
- [ ] **Definir o período de rollback da Z-API**: recomendação inicial de manter o cadastro antigo inativo por 7 dias antes de encerrar o serviço
- [ ] **Templates de mensagem** — textos das automações que a Dra. quer usar:
  - Lembrete de consulta (ex: "Olá {nome}, lembro sua consulta amanhã às {hora}…")
  - Lembrete de cirurgia
  - Cobrança de pagamento pendente
  - Link de anamnese pré-consulta
  - Follow-up pós-consulta
- [ ] **Número de horas de antecedência** para cada lembrete (ex: 24h antes da consulta)

#### O que será executado pela implementação após os acessos

- [ ] Atualizar o sistema da VPS, criar usuário operacional, restringir SSH e configurar firewall
- [ ] Instalar Docker e subir Evolution API com versão estável fixada, PostgreSQL e Redis persistentes
- [ ] Configurar volumes, reinício automático, backup diário e procedimento de restauração
- [ ] Publicar somente HTTPS por proxy reverso e emitir certificado válido para `evolution.surgimetrics.com.br`
- [ ] Gerar uma chave global forte da Evolution e mantê-la exclusivamente no servidor/Vercel
- [ ] Configurar na Vercel `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_REQUEST_TIMEOUT_MS` e `WHATSAPP_WEBHOOK_BASE_URL`
- [ ] Conferir as colunas, índices, RLS e bucket de mídia depois da aplicação dos SQLs
- [ ] Criar a instância de homologação pelo SurgiMetrics, configurar e reler o webhook e apresentar o QR Code
- [ ] Validar envio e recebimento de texto, imagem, áudio, vídeo e documento nos dois sentidos
- [ ] Validar mensagens enviadas pelo celular, grupos, endereços `@lid`, responsáveis e vínculo correto com paciente/contato
- [ ] Validar estados `sent`, `delivered` e `read`, deduplicação, reprocessamento de falhas e reconexão após reinício
- [ ] Validar persistência da sessão, PostgreSQL, Redis, eventos brutos e arquivos do Storage após reiniciar os contêineres
- [ ] Manter automações desligadas durante a homologação e ativá-las apenas depois dos testes manuais
- [ ] Migrar o número definitivo, monitorar a estabilização e somente depois encerrar a Z-API

> Runbook técnico: `docs/EVOLUTION_API_DEPLOY.md`. Nenhuma credencial real deve ser adicionada a esse arquivo, ao Git ou ao chat do projeto.

---

### Emissão de Boletos (se escolher Caminho A — gateway)
- [ ] **Definir o primeiro provedor de cobrança**: Asaas para ativação imediata ou o banco PJ da clínica para integração direta
- [ ] Para banco direto: contratar/habilitar as APIs de Pix Cob, boleto, consulta/cancelamento, webhook e extrato; obter sandbox, convênio/carteira e exigências de certificado mTLS/IP fixo
- [ ] **Access Token / API Key** do gateway
- [ ] Confirmar **quais dados dos pacientes** serão usados na cobrança (CPF obrigatório no Asaas — verificar se todos os pacientes têm CPF cadastrado)

### Emissão de Boletos (se escolher Caminho B — banco direto)
- [ ] **Qual banco** tem a conta PJ da clínica?
- [ ] **Solicitação de acesso à API de cobrança** junto ao gerente do banco
- [ ] **Certificado e-CNPJ A1** no nome do CNPJ da clínica (arquivo `.pfx`/`.p12` + senha)
  - Emitido por: Serasa, Certisign, Valid ou outra AC credenciada ICP-Brasil
  - Custo: R$ 200–400 · Validade: 1 ano
- [ ] **Credenciais OAuth do banco** (`client_id` + `client_secret`) após aprovação do acesso

---

### Google Agenda
- [ ] **Email da conta Google** da Dra. Vitoria (para adicionar como test user no OAuth consent screen, se o app ainda estiver em modo "Testing")
- [ ] Confirmar se o Google Cloud project com `client_id` iniciando em `530038901215` ainda está ativo

---

### Assinatura Digital (Fase 4)
- [ ] **Certificado digital ICP-Brasil** da Dra. Vitoria (responsabilidade da clínica — Zentri não emite)
- [ ] Confirmar se a Fase 1 (upload de PDF já assinado externamente) é suficiente para começar

---

### Controle de Acesso por Perfil (Fase 1 — pendente)
- [x] Emails de Jonas (jonassg1996@gmail.com), Sumary (sumaryoliveira72@gmail.com), Jessica (jessycachriis26@gmail.com) e Vitoria (vitoria.ribeiroo.cardoso@gmail.com) — ✅ recebidos em 2026-10-08
- [x] Permissões por módulo confirmadas pela Dra. Vitoria em 2026-10-08 — ✅ documentadas no CLAUDE.md e spec
- [x] **Email de Augusto** — Draugustoribeiroplastica@gmail.com ✅ recebido em 2026-10-08
- [x] **Email de Lunara** — luhbentom@gmail.com ✅ recebido em 2026-10-08 · já tem conta ativa na plataforma
- [ ] Confirmar se **Jonas** pode ver o valor total do paciente no drawer, ou apenas cadastrar (sem visualizar histórico financeiro do paciente)

---

## ✅ Já fornecido / confirmado

| Item | Data | Status |
|------|------|--------|
| Perfis de acesso (Admin / Gestão / Equipe) e quem é cada um | 2026-10-08 | ✅ |
| Permissões detalhadas por módulo (financeiro, WhatsApp, etc.) | 2026-10-08 | ✅ |
| Emails de toda a equipe (Vitoria, Augusto, Lunara, Jonas, Sumary, Jessica) | 2026-10-08 | ✅ |
| WhatsApp Business obrigatório (não pessoal) | 2026-10-08 | ✅ |
| Provedor do WhatsApp: Evolution API self-hosted, com migração gradual da Z-API | 2026-10-16 | ✅ |
| Escopo excluído: receituário de controle especial (azul/amarela) | — | ✅ |
| Escopo excluído: histórico clínico antigo do Amigo | — | ✅ |
| Certificado digital ICP-Brasil é responsabilidade da clínica | — | ✅ |
| Domínio: `surgimetrics.com.br` | — | ✅ Ativo |

---

## Como usar este arquivo

- Quando uma pendência for resolvida, marcar com ✅ e anotar a data
- Quando um item bloqueante for desbloqueado, mover para a seção "Já fornecido"
- Adicionar novas pendências à medida que surgirem nas reuniões com a clínica
