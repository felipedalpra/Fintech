# Plano substituído — não implementar

Este plano de 2026-10-08 foi descontinuado porque propunha uma função serverless, uso de IA e flags nas tabelas operacionais. Essas decisões violam os guardrails atuais do financeiro e o limite da Vercel Hobby.

A fonte vigente é:

[`docs/superpowers/specs/2026-10-14-bank-reconciliation-design.md`](../specs/2026-10-14-bank-reconciliation-design.md)

Regras que substituem integralmente o conteúdo anterior:

- parse OFX/CSV exclusivamente no navegador;
- nenhuma função serverless nova e nenhuma IA para casamento;
- sugestões determinísticas sobre parcelas do razão canônico;
- vínculo aditivo, auditável e reversível, sem alterar lançamentos ou métricas;
- criação opcional somente pelo formulário financeiro existente e com confirmação;
- RLS por clínica, RPCs Postgres transacionais, testes unitários e E2E real.
