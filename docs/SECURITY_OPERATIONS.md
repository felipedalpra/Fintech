# Operação segura — checklist da fase 3

## Já implementado no código

- Upload clínico: o servidor baixa o objeto privado, calcula SHA-256, identifica o MIME pelos bytes, confere extensão e tamanho e só então muda o status para `available`.
- Rate limiting persistente: WhatsApp/Meta, envio de mensagens, webhook de assinatura SaaS (Asaas), recorrências e conclusão de upload usam `consume_api_rate_limit`, armazenado no Supabase.
- Eventos de segurança: acessos administrativos, negativas de acesso, webhooks negados e bloqueios de rate limit entram em `security_events`, sem guardar tokens ou conteúdo clínico.
- RLS: funções `SECURITY DEFINER` legadas recebem `search_path` fixo e privilégios públicos são revogados quando não são necessários.
- CSP: primeiro em `Content-Security-Policy-Report-Only`, com allowlist derivada do mapa atual de scripts e integrações.

## Ordem obrigatória de aplicação

1. Aplicar `supabase/security_hardening_schema.sql`.
2. Aplicar `supabase/security_rls_hardening.sql`.
3. Aplicar `supabase/clinical_assets_server_validation.sql`.
4. Publicar o backend/frontend depois das migrations.
5. Conferir no Supabase que `security_events` e `api_rate_limit_buckets` não têm grants para `anon` ou `authenticated`.

## Rotação e separação de segredos

Cada segredo deve existir somente no escopo que o utiliza. Nunca configurar chaves privadas como `VITE_*`:

| Integração | Onde fica | Rotação segura |
| --- | --- | --- |
| Supabase | Vercel, somente `SUPABASE_SERVICE_ROLE_KEY` no servidor; `VITE_SUPABASE_ANON_KEY` é pública | gerar nova service-role key, atualizar Vercel, redeploy, revogar a antiga |
| Meta | Vercel: `META_APP_SECRET`, `META_VERIFY_TOKEN`; tokens por clínica ficam criptografados no banco | gerar novo App Secret/verify token, atualizar webhook e Vercel, testar assinatura e revogar tokens antigos |
| WhatsApp/Evolution | Vercel: `EVOLUTION_API_KEY`; segredo por número no banco | gerar nova chave global, atualizar Vercel/redeploy, revalidar webhooks e renovar segredos por número |
| Asaas (assinatura SaaS) | Vercel: `SAAS_BILLING_ASAAS_API_KEY`, `SAAS_BILLING_WEBHOOK_TOKEN` | criar chave/token novo na conta da Zentri, atualizar Vercel primeiro, testar evento assinado, revogar o anterior |
| Vercel | painel do projeto e membros da equipe | revisar membros, remover tokens pessoais antigos e exigir MFA |

Após cada rotação: verificar logs sem valores de segredo, executar um fluxo positivo e um negativo, e confirmar que o valor antigo foi revogado no provedor.

## RLS e recuperação — teste controlado

- RLS: no Supabase SQL Editor, conferir `pg_policies`, `information_schema.role_table_grants` e `pg_proc.prosecdef`; nenhum dado clínico deve ser acessível por outro `owner_id`, e nenhuma função `SECURITY DEFINER` deve ficar sem `proconfig` contendo `search_path`.
- Backup: criar um backup lógico ou snapshot nomeado antes do teste; registrar timestamp, versão e retenção.
- Restauração: restaurar em um projeto/ambiente separado, aplicar migrations até a mesma versão e executar `npm run test:unit` contra os endpoints apontados para o ambiente de teste.
- Perda de volume: para Evolution/Railway, provisionar um volume temporário, restaurar a configuração, validar conexão, QR, webhook, mídia e mensagens; não testar destruição no volume de produção.
- Revogação: revogar uma sessão de teste no Supabase Auth, confirmar que o token antigo falha nos endpoints protegidos e que uma nova sessão funciona.
- CSP: observar violações por pelo menos um ciclo real de uso; somente então trocar `Report-Only` por `Content-Security-Policy` e manter rollback imediato.

Login continua protegido pelo rate limiting nativo do Supabase Auth; a configuração deve ser conferida em Authentication → Rate Limits antes de considerar a etapa encerrada.
