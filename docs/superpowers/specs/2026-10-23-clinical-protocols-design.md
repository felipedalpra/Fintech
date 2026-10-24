# Protocolos clínicos por procedimento

## 1. Goal

Permitir que a clínica padronize anamnese, plano terapêutico, exames, orientações, fotografias e retornos por procedimento, mantendo revisão humana e histórico versionado.

## 2. Usuários e permissões

- Todo perfil com acesso clínico pode consultar e aplicar protocolos ativos.
- Somente owner ou membro `admin` com acesso clínico pode criar, revisar, arquivar ou reativar um protocolo compartilhado.
- Aplicar um protocolo apenas preenche um rascunho. O profissional continua responsável por revisar e assinar o registro clínico.

## 3. Fluxo principal

1. O administrador abre **Clínico → Protocolos**.
2. Cria um protocolo informando procedimento, textos-base, perguntas complementares, kit de exames, orientações fotográficas e retornos.
3. Alterações posteriores criam uma nova versão; versões anteriores não são sobrescritas.
4. Na anamnese, o profissional escolhe um protocolo e responde às perguntas complementares obrigatórias.
5. No plano terapêutico, o profissional escolhe um protocolo para preencher indicação, objetivos, tratamento, orientações e etapas de retorno.
6. O conteúdo é revisado antes da gravação. Nenhum diagnóstico, prescrição, pedido ou evolução é emitido automaticamente.

## 4. Modelo de dados

- `clinical_protocols`: identidade estável do protocolo na clínica.
- `clinical_protocol_versions`: snapshots imutáveis e numerados do conteúdo.
- `clinical_protocol_status_events`: histórico append-only de ativação/arquivamento.
- `clinical_anamneses.protocol_*`: snapshot do protocolo e respostas efetivamente utilizados na anamnese, preservando o registro mesmo após nova versão.

Todas as escritas ocorrem por RPC idempotente e validada. Não há `UPDATE`/`DELETE` direto nem nova função serverless.

## 5. Estados e falhas

- Sem protocolos: estado vazio orienta a criação pelo administrador.
- Sem permissão administrativa: biblioteca somente leitura.
- Falha de carga ou gravação: editor permanece aberto e o protocolo anterior não é alterado.
- Reenvio com o mesmo `request_id`: devolve o resultado original somente quando o payload é idêntico.
- Arquivamento: reversível por novo evento; registros antigos continuam apontando para o snapshot aplicado.

## 6. Segurança e conformidade

- RLS por `data_owner_id()` e `has_clinical_access()`.
- Conteúdo clínico não é carregado em áreas administrativas.
- Autoria contém snapshot de nome, conselho e registro profissional.
- Modelos são apoio à documentação, não decisão clínica automatizada.
- A assinatura eletrônica atual permanece autoria autenticada; ICP-Brasil só será declarada após homologação do provedor.

## 7. Mapa de propagação

```text
Biblioteca da clínica
  └─ versão ativa do protocolo
      ├─ Anamnese → rascunho + respostas complementares → clinical_anamneses
      └─ Plano → rascunho revisável + retornos → clinical_treatment_*

Versão nova/arquivamento
  ├─ muda apenas futuras aplicações
  └─ não altera anamneses, planos ou documentos já registrados
```

## 8. Checklist de fidedignidade

- [x] O protocolo nunca grava prontuário, receita ou pedido sem confirmação humana.
- [x] A versão aplicada é preservada como snapshot no registro clínico.
- [x] Revisar protocolo não modifica registros anteriores.
- [x] Arquivar é reversível e não apaga dados.
- [x] Clínica e paciente continuam isolados por RLS.
- [x] Plano e Agenda continuam usando seus registros canônicos existentes.
- [x] Nenhum valor financeiro é criado ou alterado.
- [x] Nenhuma função serverless é adicionada.

## 9. Visual simples

```text
┌ Protocolos da clínica ────────────────────────────────┐
│ Mamoplastia redutora                       Ativo · v3 │
│ 8 perguntas · 12 exames · 5 fotos · 2 retornos       │
│ [Visualizar] [Criar nova versão] [Arquivar]           │
└───────────────────────────────────────────────────────┘

Nova anamnese / Novo plano
┌ Usar protocolo: Mamoplastia redutora v3 ─────────────┐
│ O conteúdo abaixo é um rascunho. Revise antes salvar.│
└───────────────────────────────────────────────────────┘
```

## 10. Testes

- Unitários: normalização, validação e aplicação de protocolo em anamnese/plano.
- PostgreSQL: instalação limpa, reaplicação, RLS entre clínicas, permissão administrativa, imutabilidade, idempotência e versão/snapshot.
- E2E: biblioteca, criação/revisão e aplicação visual em um plano.
- Build completo.
