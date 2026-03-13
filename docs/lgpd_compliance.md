# LGPD Compliance

Este projeto foi ajustado para reduzir exposição de dados pessoais e sensíveis, mas isso não equivale, por si só, a certificação jurídica de conformidade. A conformidade final depende de operação, contratos, base legal, governança e configuração correta do ambiente.

## Escopo do tratamento

O sistema manipula ou pode manipular:
- nome do paciente
- identificadores internos do paciente
- histórico operacional de consultas e cirurgias
- dados financeiros vinculados ao paciente
- dados de autenticação dos usuários da clínica

Campos como CPF, telefone, e-mail pessoal do paciente e dados médicos detalhados não devem ser coletados no payload operacional atual. Caso sejam necessários, devem migrar para estrutura separada e protegida no banco.

## Medidas aplicadas no código

### Minimização de dados
- formulários foram ajustados para incentivar uso de “Paciente ou ID interno”
- observações de cirurgia passaram a orientar explicitamente que não se insiram dados clínicos sensíveis
- o fluxo comercial inativo deixou de coletar telefone e CPF/CNPJ sem necessidade operacional imediata

### Anonimização e pseudonimização
- a interface interna da plataforma pode exibir o nome real do paciente para usuários autenticados e autorizados da clínica
- logs, integrações externas e qualquer contexto enviado para IA devem operar sem nome civil, telefone, CPF ou outros identificadores diretos
- o contexto da IA no app é composto por métricas agregadas e dados financeiros estruturados sem identificadores pessoais
- utilitários de LGPD foram adicionados em [src/privacy/lgpd.js](/Users/felipedalpra/Desktop/startup-finance/src/privacy/lgpd.js:1):
  - `anonymizeFinanceData()`
  - `exportPatientData()`
  - `anonymizePatientData()`
  - `deletePatientData()`
  - `buildPrivacyAudit()`

### IA com contexto anonimizado
- a IA não recebe nome civil do paciente
- o contexto analítico é derivado de métricas agregadas
- o endpoint da IA opera sobre contexto financeiro estruturado, sem identificadores diretos do titular

## Arquitetura recomendada

Para produção, o modelo recomendado é:
- `patients_identity`
- `patients_health_data`
- `financial_records`
- `consent_records`
- `audit_logs`
- `user_roles`

O schema recomendado está em [supabase/lgpd_schema.sql](/Users/felipedalpra/Desktop/startup-finance/supabase/lgpd_schema.sql:1).

## Medidas ainda obrigatórias fora do frontend

### Criptografia
- HTTPS obrigatório em produção
- criptografia em repouso para campos sensíveis
- segregação de chaves e rotação operacional

### Controle de acesso
- RBAC por papel:
  - `admin`
  - `medico`
  - `secretaria`
  - `financeiro`

### Logs de auditoria
- acesso
- edição
- exclusão
- exportação
- anonimização

### Direitos do titular
- acesso
- correção
- anonimização
- exclusão
- portabilidade

## Limitações atuais

- se o ambiente ainda estiver usando a tabela legada `user_finance_data.payload`, nomes reais continuam armazenados no payload para preservar a usabilidade interna
- isso atende ao uso operacional da clínica, mas não é a arquitetura final ideal para dados sensíveis sob LGPD
- para produção com maior rigor, a recomendação é migrar para o schema relacional segregado

## Próximo passo técnico recomendado

1. migrar do payload JSON para o schema relacional LGPD
2. implementar RBAC com `user_roles`
3. instrumentar logs de auditoria no backend
4. isolar dados de saúde em tabela própria com criptografia
5. expor funções seguras de exportação, anonimização e exclusão via backend
