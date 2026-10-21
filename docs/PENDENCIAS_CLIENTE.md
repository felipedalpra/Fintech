# Pendências da Clínica — SurgiMetrics

> Itens que precisam ser fornecidos ou decididos pela Dra. Vitoria / Augusto antes ou durante cada fase de implementação.
> Atualizado em: 2026-10-21

---

## Checklist para levar à clínica — fase clínica atual

Este é o pacote que a Dra. Vitoria / Augusto precisam enviar ou confirmar para que o módulo clínico seja desenhado conforme o fluxo que a equipe realmente usava no Amigo. Prints, vídeos, fichas e documentos devem estar **sem dados identificáveis de pacientes**.

### Prioridade 1 — enviar agora

| Tema | O que a clínica precisa enviar ou confirmar | Formato sugerido |
|------|----------------------------------------------|------------------|
| **Referência do Amigo** | Gravação curta ou sequência de prints mostrando os fluxos que a equipe usava: agenda, busca/cadastro do paciente, abertura do prontuário, nova evolução, anamnese, pedido de exames, receituário, documentos e anexos/fotos. Informar também o que funcionava bem e o que incomodava no Amigo. | Vídeo de tela ou prints, sempre com paciente fictício ou dados ocultos |
| **Ficha de anamnese** | Ficha completa usada hoje, com todas as perguntas, opções de resposta e indicação dos campos obrigatórios. Informar se existem fichas diferentes por procedimento e se ela é preenchida pelo paciente, pela equipe ou pelo médico. | PDF, prints ou formulário exportado do Amigo |
| **Termos e consentimentos** | TCLE, consentimento para tratamento de dados, autorização de uso de imagem, termos cirúrgicos e outros termos que precisam ser aceitos ou assinados durante a jornada. Informar em qual etapa cada termo é usado e quem assina. | Modelos em PDF/DOCX, sem assinatura real de paciente |
| **Timbre e identificação profissional** | Logo em boa qualidade; nome legal da clínica; CNPJ, endereço, telefone e e-mail; e, para cada profissional que emitirá ou assinará documentos, nome completo, conselho, número/UF, especialidade e RQE quando aplicável. | Logo em SVG ou PNG transparente + dados em texto |
| **Pedidos de exames** | Relação dos exames mais pedidos, kits prontos (pré-operatório, cardiológico etc.), observações/instruções padrão e um exemplo anonimizado de pedido atual. | Planilha/lista + PDF de exemplo |
| **Receituário** | Medicamentos mais prescritos, apresentação/concentração, posologia e orientações padrão, modelos usados pela clínica e um exemplo anonimizado. Confirmar que receitas de controle especial continuam fora do escopo. | Planilha/lista + PDF de exemplo |
| **Documentos clínicos** | Modelos de atestado, relatório, declaração, encaminhamento e qualquer outro documento recorrente. Indicar quais dados devem ser preenchidos automaticamente e quais exigem assinatura. | Modelos em PDF/DOCX |
| **Fotos clínicas** | Procedimentos que usam antes/depois, regiões do corpo, ângulos/posições padronizados, nomenclatura desejada e quem pode visualizar. Confirmar o termo de autorização de imagem e as regras de retenção/remoção. | Guia, exemplos sem identificação e termos correspondentes |

### Prioridade 2 — confirmar antes da ativação de integrações

| Tema | O que a clínica precisa enviar ou confirmar | Observação de segurança |
|------|----------------------------------------------|-------------------------|
| **Migração do Amigo** | Exportação dos cadastros de pacientes, descrição das colunas e uma amostra anonimizada para validação. Confirmar quais cadastros estão ativos e quais devem ser descartados/mesclados. | O histórico clínico antigo continua fora do escopo; o arquivo real será transferido por canal seguro |
| **Assinatura digital** | Informar se cada profissional já possui certificado ICP-Brasil, qual o tipo/provedor, validade e em quais documentos a assinatura é obrigatória. Indicar uma pessoa para acompanhar a homologação. | Não enviar arquivo do certificado, senha, token ou chave privada por e-mail, WhatsApp, Git ou por este documento |
| **Google Agenda** | Conta Google responsável, calendários que devem sincronizar, tipos de atendimento, duração padrão, cores e regras de bloqueio/disponibilidade. | A autorização será feita pelo titular via OAuth; não enviar senha da conta |
| **WhatsApp** | Número de homologação, futuro número definitivo, responsáveis pelos testes e textos aprovados para anamnese, consulta, cirurgia, cobrança e pós-consulta. | A conexão será homologada por QR Code; não enviar credenciais pessoais |

### Funcionalidades adiadas — não bloqueiam a fase atual

- [ ] **Transcrição de consulta** — decidir provedor, consentimento, retenção de áudio e revisão médica em uma fase futura
- [ ] **Teleconsulta** — definir plataforma, agenda, sala de vídeo, consentimentos e requisitos operacionais em uma fase futura
- [ ] **Resultados automáticos de laboratório** — mapear laboratórios, disponibilidade de API/padrão de integração e autorização de acesso em uma fase futura

> Não é necessário pedir acessos, credenciais, contratos ou materiais dessas três funcionalidades agora. Quando entrarem no roadmap, cada uma terá uma descoberta e uma integração próprias.

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

### Anamnese clínica SOAP
- [x] **Aplicar no Supabase** a migration aditiva `supabase/clinical_anamnesis_cfm_schema.sql` depois de `supabase/clinical_record_foundation_schema.sql` — aplicada em 2026-10-20
- [x] **Aplicar no Supabase** a correção `supabase/clinical_anamnesis_review_fixes.sql`, que adiciona idempotência às assinaturas — aplicada em 2026-10-20
- [ ] Homologar com a Dra. Vitoria os campos obrigatórios e os modelos específicos por procedimento; até essa validação, a tela usa o núcleo clínico geral baseado em CFM/SBIS

### Timbre para documentos (Pedido de Exames + Receituário + Prontuário)
- [x] **Aplicar no Supabase** a migration aditiva `supabase/clinical_documents_schema.sql` depois das migrations da fundação clínica — aplicada em 2026-10-20
- [x] **Aplicar no Supabase** a correção aditiva `supabase/clinical_documents_review_fixes.sql` depois de `clinical_documents_schema.sql` — aplicada em 2026-10-20; restringe receitas a admin e corrige idempotência, auditoria clínica, timbre e validações
- [ ] **Logo da clínica** — arquivo PNG ou SVG, fundo transparente
- [ ] **Nome completo** da Dra. Vitoria como aparece nos documentos clínicos
- [ ] **CRM** da Dra. Vitoria (número + UF, ex: CRM-SP 123456)
- [ ] **Endereço completo** da clínica (rua, número, bairro, cidade, CEP)
- [ ] **Telefone/contato** para constar no rodapé dos documentos
- [ ] **Homologar em produção com dados reais da clínica** a emissão, a impressão e o salvamento em PDF de um pedido de exames e uma receita simples, conferindo timbre, identificação profissional, endereço do paciente e histórico após recarregar a página

> Esses dados são configurados em Configurações → Perfil e aparecem nos documentos gerados. Nesta primeira versão, o PDF é preparado para impressão e assinatura manual; assinatura eletrônica qualificada será uma integração posterior.

---

### Pedido de Exames
- [ ] **Lista de exames** mais solicitados pela Dra. (hemograma, coagulação, ECG, etc.)
- [ ] **Kits pré-definidos** — ex: "Kit pré-operatório" com quais exames? "Kit cardio"? Quais outros kits usa com frequência?

---

### Receituário
- [ ] **Lista de medicamentos** mais prescritos (nome comercial ou princípio ativo)
- [ ] **Posologia padrão** de cada medicamento (ex: Dipirona 500mg — 1 comprimido de 8/8h por 3 dias)
- [ ] Confirmar que **receitas de controle especial (azul/amarela) estão fora do escopo** ← já acordado, confirmar se permanece assim
- [ ] Confirmar que **antimicrobianos, GLP-1 e outros medicamentos sujeitos à retenção** também permanecem fora desta primeira versão

---

### WhatsApp CRM e Automações (Fase 2)
- [x] **Provedor de WhatsApp escolhido** — Evolution API self-hosted, com Z-API temporariamente disponível para rollback. ✅ 2026-10-16

> **Status verificado em 2026-10-21:** implementação e SQLs estão publicados. A Evolution API v2.3.7 foi ativada em URL HTTPS pública no Railway, substituindo a VPS e o DNS próprio planejados; as quatro variáveis server-side foram cadastradas na Vercel Production e o app foi redeployado. Um smoke test real confirmou autenticação, criação de instância/QR, webhook com segredo, consulta de conexão e limpeza. Falta conectar o número de homologação pela interface e testar mensagens, mídias, status e persistência após reinício. Não migrar o número definitivo antes dessa homologação.

#### O que Felipe / cliente precisa providenciar

- [x] **Publicar a Evolution API em infraestrutura persistente** — Railway com Evolution API v2.3.7 e HTTPS público, substituindo a VPS HostGator planejada ✅ 2026-10-21
- [x] **Definir o endereço público da Evolution** — domínio gerenciado pelo Railway; o subdomínio próprio `evolution.surgimetrics.com.br` não é necessário nesta etapa ✅ 2026-10-21
- [x] **Confirmar acesso ao projeto correto da Vercel e cadastrar as variáveis server-side** sem registrar valores no código ou na documentação ✅ 2026-10-21
- [x] **Aplicar no Supabase o novo SQL** `supabase/whatsapp_evolution_provider_schema.sql` ✅ aplicado em 2026-10-16
- [x] **Confirmar/aplicar `supabase/whatsapp_media_storage.sql`** antes da homologação de anexos ✅ aplicado em 2026-10-16
- [ ] **Aplicar `supabase/whatsapp_three_number_safety.sql`** antes da conexão dos três números; ele adiciona isolamento composto por clínica+número e idempotência do envio interativo
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

- [x] Publicar Evolution API v2.3.7 com HTTPS no Railway ✅ 2026-10-21
- [ ] Confirmar PostgreSQL e Redis persistentes, política de backup e restauração no Railway
- [x] Gerar uma chave global forte da Evolution e mantê-la exclusivamente no servidor/Vercel ✅ 2026-10-21
- [x] Configurar na Vercel Production `EVOLUTION_API_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_REQUEST_TIMEOUT_MS` e `WHATSAPP_WEBHOOK_BASE_URL` ✅ 2026-10-21
- [ ] Conferir as colunas, índices, RLS e bucket de mídia depois da aplicação dos SQLs
- [x] Validar o contrato da Evolution com instância temporária: autenticação, criação/QR, configuração e releitura do webhook, estado e limpeza ✅ 2026-10-21
- [ ] Criar a instância durável de homologação pelo SurgiMetrics e apresentar o QR Code
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
