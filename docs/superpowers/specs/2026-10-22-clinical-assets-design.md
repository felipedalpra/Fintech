# Fotos e documentos clínicos privados

## 1. Goal

Permitir que a equipe com acesso clínico organize fotos de evolução e anexos do paciente, compare imagens de antes/depois e vincule um aceite de uso de imagem quando aplicável, sem tornar arquivos públicos, duplicar pacientes ou apagar evidências clínicas.

## 2. Escopo desta entrega

- Upload de JPEG, PNG, WebP e PDF diretamente do navegador para um bucket privado do Supabase Storage.
- Registro clínico por paciente com data, procedimento, região, etapa (`antes`, `depois` ou `documento`), observação e aceite de imagem opcional.
- Galeria pesquisável/filtrável e comparação lado a lado de duas fotos.
- Link assinado de curta duração somente após auditoria da abertura.
- Arquivamento reversível no índice; o objeto original não recebe `UPDATE`, `UPSERT` nem `DELETE` pela aplicação.
- Recuperação de upload que chegou ao Storage mas ainda não foi confirmado no banco.
- Sem função serverless nova e sem integração com a BRy.

Fora do escopo: edição/corte de imagem, publicação em redes sociais, autorização automática de marketing, diagnóstico por imagem, reconhecimento facial e migração de arquivos externos.

## 3. Fluxo do usuário

1. O profissional abre a ficha já auditada e entra em **Fotos e documentos**.
2. Escolhe arquivo, tipo/etapa, data, região, procedimento e observação.
3. Para foto, pode vincular um aceite de imagem já registrado para o paciente. A ausência desse vínculo não autoriza divulgação externa.
4. O banco reserva um ID e um caminho canônico dentro da clínica/paciente.
5. O navegador envia o arquivo com `upsert:false` e confirma o upload por RPC.
6. A galeria passa a exibir o registro persistido. Recarregar a página preserva o ativo.
7. Ao abrir um arquivo, uma RPC grava auditoria; depois o navegador solicita uma URL assinada curta.
8. O usuário pode escolher uma foto “antes” e uma “depois” para comparação lado a lado.
9. Arquivar retira o item da visualização padrão, mas mantém metadados e arquivo.

## 4. Visual simples

```text
┌ Fotos e documentos ───────────────────────────────────────────┐
│ [Adicionar arquivo]  [Todos ▾] [Região ▾] [Buscar...]         │
├───────────────────────────────┬───────────────────────────────┤
│ Galeria                       │ Comparação                    │
│ ┌────────┐ ┌────────┐         │ Antes ▾       Depois ▾        │
│ │ foto   │ │ laudo  │         │ ┌──────────┐ ┌──────────┐     │
│ │ antes  │ │ PDF    │         │ │ imagem   │ │ imagem   │     │
│ └────────┘ └────────┘         │ └──────────┘ └──────────┘     │
└───────────────────────────────┴───────────────────────────────┘
```

No mobile, comparação e galeria ficam em uma coluna e os seletores permanecem visíveis acima das imagens.

## 5. Modelo de dados e segurança

### `clinical_assets`

- `id`, `user_id`, `patient_id`, `created_by`;
- `asset_kind`: `clinical_photo` ou `document`;
- `stage`: `before`, `after` ou `neutral`;
- `captured_on`, `region`, `procedure_name`, `notes`;
- `bucket_id`, `object_path`, `file_name`, `mime_type`, `file_size`, `client_sha256`;
- `consent_acceptance_id` opcional e sempre do mesmo paciente/clínica;
- `status`: `uploading`, `available`, `failed`, `archived`;
- datas de criação, conclusão, falha e arquivamento.

O caminho é criado no banco como:

```text
<owner_id>/<patient_id>/<asset_id>/original.<extensão-validada>
```

O bucket `clinical-assets` é privado. Policies de Storage exigem acesso clínico, conferem clínica, paciente, ativo reservado e autor do upload. Não existe policy de `UPDATE` ou `DELETE` para o navegador.

RPCs transacionais:

- `create_clinical_asset_upload`: valida paciente, metadados, aceite e reserva caminho.
- `complete_clinical_asset_upload`: confirma que o objeto existe no caminho reservado e registra tamanho/MIME observados pelo Storage.
- `fail_clinical_asset_upload`: marca tentativa incompleta sem apagar histórico.
- `set_clinical_asset_archived`: arquiva ou restaura metadados sem apagar o objeto.
- `log_clinical_asset_access` e `log_clinical_asset_accesses`: auditam abertura individual ou galeria em lote antes das URLs assinadas.

## 6. Permissões

- Owner e membros com `clinical_access=true`: podem listar, abrir, subir e arquivar ativos clínicos.
- Perfis sem acesso clínico: não veem aba, metadados ou objetos, mesmo conhecendo o caminho.
- `anon`: nenhum acesso.
- Acesso de leitura e escrita sempre usa `data_owner_id()`; a interface não é a barreira de segurança.
- O vínculo com aceite de imagem é informativo para o uso autorizado pelo termo. Ele não converte uma foto clínica em material de marketing.

## 7. Mapa de propagação

| Origem | Persistência canônica | Consumidores | Regra |
|---|---|---|---|
| arquivo escolhido | `storage.objects` no bucket privado | visualização/download por URL assinada | nunca URL pública; nunca sobrescrever |
| metadados do upload | `clinical_assets` | ficha clínica, filtros e comparação | mesmo `user_id` e `patient_id` |
| aceite de imagem | `clinical_consent_acceptances` | selo informativo do ativo | vínculo opcional, mesma clínica/paciente |
| abertura do ativo | `clinical_record_access_logs` | auditoria clínica | logar antes de gerar URL assinada |
| arquivamento | `clinical_assets.status/archived_at` | galeria | reversível no dado; arquivo preservado |

O módulo não escreve no financeiro, agenda, prontuário SOAP, DRE ou métricas. Ele referencia o mesmo paciente canônico e não cria cadastro paralelo.

## 8. Checklist de fidedignidade

- [x] O arquivo mostrado pertence ao registro clínico selecionado.
- [x] Clínica e paciente são conferidos no banco e no caminho do Storage.
- [x] O upload não usa `upsert` e não substitui arquivo existente.
- [x] Um registro só vira `available` se o objeto existir no caminho reservado.
- [x] Upload confirmado persiste após recarregar.
- [x] Falha parcial fica explícita e pode ser finalizada novamente; não aparece como sucesso.
- [x] Arquivar não apaga banco nem Storage.
- [x] URL é privada, assinada e curta; não é armazenada no banco.
- [x] Abertura é auditada antes de entregar o acesso temporário.
- [x] Aceite de imagem não é inferido e não autoriza marketing além do texto aceito.
- [x] Nenhuma autoria médica, diagnóstico ou conteúdo SOAP é criado automaticamente.
- [x] Nenhuma função serverless nova.

## 9. Testes e rollout

- Testes unitários: normalização de arquivo, caminho exibido, filtros e seleção de comparação.
- PostgreSQL descartável: RLS cross-clínica, caminho canônico, aceite do mesmo paciente, transições de estado, objeto obrigatório, auditoria e reaplicação.
- E2E: upload real interceptado no navegador, persistência simulada do contrato Supabase, comparação e arquivamento.
- `npm run build` e suíte clínica existente.
- Migration aditiva e idempotente em `supabase/clinical_assets_schema.sql`; Felipe executa manualmente antes da homologação.
