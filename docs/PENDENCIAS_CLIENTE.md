# Pendências da Clínica — SurgiMetrics

> Itens que precisam ser fornecidos ou decididos pela Dra. Vitoria / Augusto antes ou durante cada fase de implementação.
> Atualizado em: 2026-10-08

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
- [ ] **Provedor de WhatsApp escolhido** — Evolution API (self-hosted) ou serviço gerenciado (Z-API, WPPConnect)? Ou API oficial Meta Business?
- [ ] **Templates de mensagem** — textos das automações que a Dra. quer usar:
  - Lembrete de consulta (ex: "Olá {nome}, lembro sua consulta amanhã às {hora}…")
  - Lembrete de cirurgia
  - Cobrança de pagamento pendente
  - Link de anamnese pré-consulta
  - Follow-up pós-consulta
- [ ] **Número de horas de antecedência** para cada lembrete (ex: 24h antes da consulta)

---

### Emissão de Boletos (se escolher Caminho A — gateway)
- [ ] **Conta criada no gateway escolhido** (Asaas, EFÍ ou Iugu) com CNPJ da clínica
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
- [ ] Confirmar **emails de cada usuário** que terá acesso:
  - Administrador: Dra. Vitoria + Augusto
  - Gestão: Lunara
  - Equipe (secretaria/recepção): quem mais?
- [ ] Confirmar as **permissões por perfil** conforme tabela no CLAUDE.md (ok validar ou ajustar)

---

## ✅ Já fornecido / confirmado

| Item | Status |
|------|--------|
| Perfis de acesso (Admin / Gestão / Equipe) e quem é cada um | ✅ Confirmado no CLAUDE.md |
| Escopo excluído: receituário de controle especial (azul/amarela) | ✅ Confirmado |
| Escopo excluído: histórico clínico antigo do Amigo | ✅ Confirmado |
| Certificado digital ICP-Brasil é responsabilidade da clínica | ✅ Confirmado |
| Domínio: `surgimetrics.com.br` | ✅ Ativo |

---

## Como usar este arquivo

- Quando uma pendência for resolvida, marcar com ✅ e anotar a data
- Quando um item bloqueante for desbloqueado, mover para a seção "Já fornecido"
- Adicionar novas pendências à medida que surgirem nas reuniões com a clínica
