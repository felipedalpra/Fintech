# Evolution API — ativação e migração do WhatsApp

## Estado da aplicação

O SurgiMetrics está preparado para operar com Evolution API e manter números Z-API existentes durante a migração. A chave global da Evolution fica somente no backend; a clínica cria uma instância em **Configurações → WhatsApp** e conecta o WhatsApp Business pelo QR Code.

Antes de usar a integração real:

1. aplicar `supabase/whatsapp_evolution_provider_schema.sql` no Supabase;
2. disponibilizar a Evolution em uma VPS persistente com HTTPS;
3. configurar as variáveis server-side na Vercel;
4. homologar envio, recebimento, mídia, confirmação de entrega e reconexão com um número de teste;
5. só depois migrar o número da clínica e manter a Z-API como rollback durante a estabilização.

## Infraestrutura escolhida

- VPS HostGator NVMe 4, região Brasil;
- Ubuntu 22.04 sem cPanel;
- domínio `evolution.surgimetrics.com.br` apontando por registro A para o IP da VPS;
- Evolution API em contêiner com versão estável fixada;
- PostgreSQL e Redis persistentes;
- proxy reverso com certificado TLS válido;
- volumes e banco incluídos em backup diário.

Não publicar PostgreSQL, Redis ou o painel administrativo diretamente na internet. A porta pública deve ser apenas HTTPS; SSH deve usar chave, usuário sem login por senha e firewall restritivo.

## Variáveis da Vercel

Configurar em Preview e Production, sem prefixo `VITE_`:

```env
EVOLUTION_API_BASE_URL=https://evolution.surgimetrics.com.br
EVOLUTION_API_KEY=<chave global forte da Evolution>
EVOLUTION_REQUEST_TIMEOUT_MS=15000
WHATSAPP_WEBHOOK_BASE_URL=https://www.surgimetrics.com.br/api/whatsapp?action=webhook
```

`EVOLUTION_API_KEY` nunca deve ser enviada ao navegador, registrada em tickets ou salva na tabela de números. Cada número recebe um nome de instância e um segredo de webhook gerados no backend.

## Homologação obrigatória

Usar primeiro um número controlado, preferencialmente sem conversas importantes. O WhatsApp Business continua funcionando normalmente no celular; a Evolution aparece como um dispositivo conectado.

Validar, nesta ordem:

- criação da instância e leitura do QR Code;
- conexão marcada como `open`;
- webhook configurado e relido pela API;
- mensagem de texto nos dois sentidos;
- imagem, áudio e documento nos dois sentidos;
- mensagens enviadas pelo celular aparecendo no SurgiMetrics;
- confirmações `sent`, `delivered` e `read` sem regressão de estado;
- grupos e endereços `@lid` sem associar pessoas por aproximação;
- reentrega do mesmo webhook sem duplicar mensagens;
- reinício dos contêineres sem perder instâncias;
- reconexão por QR depois de logout controlado.

Os eventos brutos ficam em `whatsapp_webhook_events`, acessíveis apenas pelo backend, para auditoria e recuperação de falhas. Mídias recebidas são decriptadas pelo endpoint `getBase64FromMediaMessage` e copiadas para o bucket `wa-media`; portanto, `supabase/whatsapp_media_storage.sql` também precisa já estar aplicado. A interface mostra o último teste de saúde e o último webhook recebido.

## Estratégia de migração

1. deixar automações desligadas no número de homologação;
2. testar por pelo menos um ciclo operacional completo;
3. cadastrar o número definitivo na Evolution;
4. conferir histórico novo, responsáveis e automações;
5. manter o cadastro Z-API inativo durante o período de rollback;
6. encerrar o provedor antigo somente após confirmar que não há perda de mensagens.

Evolution com Baileys usa o protocolo do WhatsApp Web, não a API oficial da Meta. Isso reduz custo, mas exige monitoramento de sessão e pode sofrer desconexões ou bloqueio do número. Para operação crítica, a alternativa de menor risco contratual continua sendo a Cloud API oficial.
