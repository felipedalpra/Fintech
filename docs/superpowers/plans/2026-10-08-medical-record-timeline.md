# Prontuário Completo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evoluir o prontuário eletrônico existente para incluir linha do tempo visual, adendos (sem editar registro original), e upload de anexos (exames, fotos, TCLE assinado).

**Architecture:** O componente `MedicalRecord.jsx` existente é refatorado internamente — a lógica de sessões permanece mas o layout vira uma linha do tempo vertical. Adendos são registros separados linkados ao `medical_record_id` original (tabela `medical_record_addenda`). Anexos usam Supabase Storage no bucket `patient-documents`. Nenhum registro pode ser deletado (exigência CFM/LGPD).

**Tech Stack:** React 18, Supabase (Postgres + Storage + RLS)

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks abaixo continuam válidas.

**Contexto do cliente:** Fase 4. Prontuário com linha do tempo, adendos (sem editar o original) e anexos (exames, fotos, TCLE).

**Área e navegação:** área **Clínico → Prontuário**. **Só perfis clínicos.**

**Benchmark (o que copiar):** Amigo + referências de estética (GestãoDS, SinapSYS) — fotos antes/depois por região e data com comparação lado a lado (slider) e marcação de pontos; histórico de evoluções/anamnese na mesma tela do atendimento. Repos de padrão: Medplum, OpenEMR (evolução/adendo).

**Modelo de dados e propagação (ponto crítico — CFM/LGPD):**
- `medical_records` + `medical_record_addenda` + `patient_attachments` (Storage, bucket `patient-documents`).
- **Sem DELETE — só arquivamento.** Uma evolução salva **nunca é editada nem sobrescrita**; correção é **adendo** (registro novo linkado ao original). Exigência CFM/LGPD.
- **Registro de acesso:** quem abriu/criou/alterou cada prontuário, com data/hora, sem exclusão pela equipe.

**Permissões:** acesso restrito aos perfis clínicos definidos pelo contratante.

**Checklist de fidedignidade (desta feature):**
1. Nenhum registro de evolução pode ser apagado ou sobrescrito — só adendo e arquivamento.
2. O adendo preserva e referencia o original (linha do tempo mostra a ordem real).
3. Acesso só a perfis clínicos (UI **e** RLS); registro de acesso gravado.
4. Anexos no bucket certo, isolados por paciente/clínica (RLS); download íntegro.
5. Teste cobre: tentar editar evolução salva = bloqueado; adendo aparece após o original; anexo só visível ao perfil autorizado.

---

## Referências obrigatórias

- `src/components/MedicalRecord.jsx` — componente atual a ser refatorado
- `supabase/patients_schema.sql` — tabela `medical_records` existente
- `src/theme.js` — tokens de cor: `C.text`, `C.surface`, `C.border`, `C.accent`, `C.textSub`, `C.textDim`, `C.green`, `C.red`; **usar `C.` diretamente, nunca como função**

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `supabase/medical_record_addenda_schema.sql` | Criar | Tabela de adendos + bucket Storage + RLS |
| `src/components/MedicalRecord.jsx` | Modificar | Refatorar para linha do tempo + adendos + anexos |

---

## Task 1: Schema SQL — adendos e Storage

**Files:**
- Create: `supabase/medical_record_addenda_schema.sql`

- [ ] **Step 1.1: Criar o arquivo de migração**

```sql
-- medical_record_addenda_schema.sql
-- Executar no Supabase SQL Editor DEPOIS de patients_schema.sql.

-- Adendos: registros adicionados a uma sessão existente sem alterar o original.
create table if not exists public.medical_record_addenda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null references public.medical_records(id) on delete cascade,
  addendum_text text not null,
  created_by text,        -- nome do profissional que adicionou
  created_at timestamptz not null default timezone('utc', now())
  -- sem updated_at: adendos são imutáveis
);

-- Metadados de anexos (o arquivo fica no Storage).
create table if not exists public.patient_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  record_id uuid references public.medical_records(id) on delete set null,
  file_name text not null,
  file_path text not null,       -- caminho no bucket: {user_id}/{patient_id}/{uuid}.ext
  file_type text,                -- mime type
  label text,                    -- ex: 'Exame de sangue', 'Foto pré-op', 'TCLE assinado'
  uploaded_at timestamptz not null default timezone('utc', now())
);

-- RLS
alter table public.medical_record_addenda enable row level security;
alter table public.patient_attachments enable row level security;

do $$ begin
  begin
    -- Adendos: sem DELETE; insert/select/update bloqueados para outros usuários.
    create policy "Addenda select" on public.medical_record_addenda
      for select to authenticated using (auth.uid() = user_id);
    create policy "Addenda insert" on public.medical_record_addenda
      for insert to authenticated with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;

  begin
    create policy "Patient attachments own rows" on public.patient_attachments
      for all to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  exception when duplicate_object then null; end;
end $$;

create index if not exists idx_addenda_record on public.medical_record_addenda(record_id);
create index if not exists idx_attachments_patient on public.patient_attachments(patient_id, uploaded_at desc);
```

- [ ] **Step 1.2: Criar bucket no Supabase Storage**

No Supabase Dashboard → Storage → New bucket:
- Name: `patient-documents`
- Public: **false** (privado, acesso via signed URLs)

Depois no SQL Editor, adicionar policy de Storage:

```sql
-- Permite ao usuário autenticado ler e escrever apenas na sua pasta.
create policy "Patient docs owner" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'patient-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );
```

- [ ] **Step 1.3: Aplicar e verificar**

Executar no SQL Editor. Confirmar tabelas `medical_record_addenda` e `patient_attachments` no Table Editor. Confirmar bucket `patient-documents` no Storage.

---

## Task 2: Linha do tempo + adendos + anexos em `MedicalRecord.jsx`

**Files:**
- Modify: `src/components/MedicalRecord.jsx`

O componente atual tem ~310 linhas. Será refatorado em partes menores dentro do mesmo arquivo.

- [ ] **Step 2.1: Adicionar estado para adendos e anexos**

No topo do componente `MedicalRecord`, adicionar:

```jsx
const [addenda, setAddenda] = useState({})       // { recordId: [addendum, ...] }
const [attachments, setAttachments] = useState([])
const [addendumTarget, setAddendumTarget] = useState(null)  // recordId
const [addendumText, setAddendumText] = useState('')
const [uploadingFile, setUploadingFile] = useState(false)
```

- [ ] **Step 2.2: Carregar adendos e anexos junto com os registros**

Substituir a função `load()` existente:

```jsx
async function load() {
  setLoading(true)
  const [{ data: recs }, { data: adds }, { data: atts }] = await Promise.all([
    supabase
      .from('medical_records')
      .select('*')
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .order('session_date', { ascending: false }),
    supabase
      .from('medical_record_addenda')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
    supabase
      .from('patient_attachments')
      .select('*')
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .order('uploaded_at', { ascending: false }),
  ])

  const recList = recs ?? []
  setRecords(recList)

  const addMap = {}
  for (const add of adds ?? []) {
    if (!addMap[add.record_id]) addMap[add.record_id] = []
    addMap[add.record_id].push(add)
  }
  setAddenda(addMap)
  setAttachments(atts ?? [])
  setLoading(false)
}
```

- [ ] **Step 2.3: Função para salvar adendo**

```jsx
async function saveAddendum() {
  if (!addendumText.trim() || !addendumTarget) return
  await supabase.from('medical_record_addenda').insert({
    user_id: userId,
    record_id: addendumTarget,
    addendum_text: addendumText.trim(),
    created_by: professionalName || null,
  })
  setAddendumText('')
  setAddendumTarget(null)
  load()
}
```

- [ ] **Step 2.4: Função para upload de anexo**

```jsx
async function uploadAttachment(file, recordId) {
  setUploadingFile(true)
  const ext = file.name.split('.').pop()
  const path = `${userId}/${patientId}/${crypto.randomUUID()}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from('patient-documents')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (!uploadErr) {
    await supabase.from('patient_attachments').insert({
      user_id: userId,
      patient_id: patientId,
      record_id: recordId || null,
      file_name: file.name,
      file_path: path,
      file_type: file.type,
    })
    load()
  }
  setUploadingFile(false)
}
```

**Nota:** `crypto.randomUUID()` está disponível em browsers modernos (Chrome 92+, Safari 15+). Não precisa importar.

- [ ] **Step 2.5: Função para abrir anexo (signed URL)**

```jsx
async function openAttachment(filePath) {
  const { data } = await supabase.storage
    .from('patient-documents')
    .createSignedUrl(filePath, 60 * 60)  // 1 hora
  if (data?.signedUrl) window.open(data.signedUrl, '_blank')
}
```

- [ ] **Step 2.6: Refatorar `RecordCard` para incluir linha do tempo + adendos + anexo**

Substituir o componente `RecordCard` existente:

```jsx
function RecordCard({ rec, number, addenda, attachments, onEdit, onArchive, onAddAddendum, onUpload, onOpenFile, archived }) {
  const [expanded, setExpanded] = useState(false)
  const [showAddendum, setShowAddendum] = useState(false)
  const fileInputRef = useRef(null)

  const recAttachments = attachments.filter(a => a.record_id === rec.id)

  return (
    <div style={{
      display: 'flex',
      gap: 0,
      position: 'relative',
    }}>
      {/* Linha do tempo vertical */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32, flexShrink: 0 }}>
        <div style={{
          width: 12, height: 12, borderRadius: '50%',
          background: archived ? C.textDim : C.accent,
          border: `2px solid ${archived ? C.textDim : C.accent}`,
          marginTop: 4, flexShrink: 0, zIndex: 1,
        }} />
        <div style={{ width: 2, flex: 1, background: C.border, marginTop: 4 }} />
      </div>

      {/* Conteúdo */}
      <div style={{
        flex: 1,
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 12,
        opacity: archived ? 0.6 : 1,
      }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {number != null && (
              <span style={{ background: C.accent + '20', color: C.accent, border: `1px solid ${C.accent}44`, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                Sessão {number}
              </span>
            )}
            {archived && <span style={{ fontSize: 11, color: C.textDim, background: C.border, borderRadius: 6, padding: '2px 8px' }}>Arquivado</span>}
            <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{formatDateBR(rec.session_date)}</span>
            {rec.professional_name && <span style={{ fontSize: 12, color: C.textSub }}>· {rec.professional_name}</span>}
          </div>
          {!archived && (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button onClick={onEdit} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.textSub, fontSize: 11, borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>Editar</button>
              <button onClick={onArchive} style={{ background: 'none', border: 'none', color: C.textDim, fontSize: 11, cursor: 'pointer' }}>Arquivar</button>
            </div>
          )}
        </div>

        {/* Evolução */}
        <div style={{
          fontSize: 13, color: C.textSub, marginTop: 10, lineHeight: 1.6, whiteSpace: 'pre-wrap',
          ...(expanded ? {} : { overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }),
        }}>
          {rec.evolution_notes}
        </div>
        {rec.evolution_notes.length > 200 && (
          <button onClick={() => setExpanded(e => !e)} style={{ background: 'none', border: 'none', color: C.accent, fontSize: 12, cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit' }}>
            {expanded ? 'Menos' : 'Ver completo'}
          </button>
        )}

        {/* Procedimentos / próxima sessão */}
        {(rec.procedures_applied || rec.next_appointment_date) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {rec.procedures_applied && <span style={{ fontSize: 11, color: C.textDim, background: C.border, borderRadius: 6, padding: '3px 8px' }}>{rec.procedures_applied}</span>}
            {rec.next_appointment_date && <span style={{ fontSize: 11, color: C.cyan, background: C.cyan + '15', borderRadius: 6, padding: '3px 8px' }}>Próxima: {formatDateBR(rec.next_appointment_date)}</span>}
          </div>
        )}

        {/* Adendos */}
        {addenda.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.border}` }}>
            {addenda.map(add => (
              <div key={add.id} style={{ fontSize: 12, color: C.textSub, marginBottom: 6 }}>
                <span style={{ color: C.textDim, fontSize: 11 }}>[Adendo · {formatDateBR(add.created_at.slice(0, 10))}{add.created_by ? ` · ${add.created_by}` : ''}]</span>
                <div style={{ marginTop: 2, whiteSpace: 'pre-wrap' }}>{add.addendum_text}</div>
              </div>
            ))}
          </div>
        )}

        {/* Botão adicionar adendo */}
        {!archived && (
          <button
            onClick={() => { setShowAddendum(s => !s) ; if (!showAddendum) onAddAddendum(rec.id) }}
            style={{ background: 'none', border: 'none', color: C.textDim, fontSize: 11, cursor: 'pointer', marginTop: 8, padding: 0, fontFamily: 'inherit' }}
          >
            + Adendo
          </button>
        )}

        {/* Anexos */}
        {recAttachments.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {recAttachments.map(att => (
              <button key={att.id} onClick={() => onOpenFile(att.file_path)} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, color: C.accent, cursor: 'pointer', marginRight: 6, marginTop: 4 }}>
                📎 {att.file_name}
              </button>
            ))}
          </div>
        )}

        {/* Upload de arquivo */}
        {!archived && (
          <>
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) onUpload(e.target.files[0], rec.id) ; e.target.value = '' }} />
            <button onClick={() => fileInputRef.current?.click()} style={{ background: 'none', border: 'none', color: C.textDim, fontSize: 11, cursor: 'pointer', marginTop: 4, marginLeft: 8, fontFamily: 'inherit' }}>
              + Anexo
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2.7: Atualizar o render principal para passar as novas props**

No componente `MedicalRecord`, dentro do `.map(rec => ...)`, atualizar:

```jsx
{active.map(rec => (
  <RecordCard
    key={rec.id}
    rec={rec}
    number={sessionNumber(rec.id)}
    addenda={addenda[rec.id] ?? []}
    attachments={attachments}
    onEdit={() => openEdit(rec)}
    onArchive={() => archive(rec.id)}
    onAddAddendum={id => setAddendumTarget(id)}
    onUpload={uploadAttachment}
    onOpenFile={openAttachment}
  />
))}
```

- [ ] **Step 2.8: Adicionar modal de adendo**

Abaixo do modal de nova sessão existente, adicionar:

```jsx
<Modal
  open={!!addendumTarget}
  onClose={() => { setAddendumTarget(null); setAddendumText('') }}
  title="Adicionar adendo"
  width={500}
>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <p style={{ fontSize: 12, color: C.textSub, margin: 0 }}>
      Um adendo é um complemento imutável ao registro original. Não substitui nem altera o texto da sessão.
    </p>
    <textarea
      value={addendumText}
      onChange={e => setAddendumText(e.target.value)}
      placeholder="Observação complementar…"
      rows={4}
      style={{ ...base.input, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
    />
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
      <Btn variant="ghost" onClick={() => { setAddendumTarget(null); setAddendumText('') }}>Cancelar</Btn>
      <Btn onClick={saveAddendum} disabled={!addendumText.trim()}>Salvar adendo</Btn>
    </div>
  </div>
</Modal>
```

- [ ] **Step 2.9: Adicionar import de `useRef`**

Verificar que `useRef` está no import do React:

```jsx
import { useEffect, useRef, useState } from 'react'
```

- [ ] **Step 2.10: Testar no browser**

```bash
npm run dev
```

1. Abrir um paciente → aba Prontuário
2. Confirmar que a linha do tempo vertical aparece
3. Criar uma nova sessão → confirmar que aparece no topo da timeline
4. Clicar em "+ Adendo" → escrever e salvar → confirmar que aparece abaixo do registro
5. Clicar em "+ Anexo" → selecionar um arquivo PDF → confirmar que o nome do arquivo aparece
6. Clicar no nome do arquivo → confirmar que abre em nova aba

- [ ] **Step 2.11: Commit**

```bash
git add supabase/medical_record_addenda_schema.sql src/components/MedicalRecord.jsx
git commit -m "feat: prontuário com linha do tempo, adendos e upload de anexos"
```

- [ ] **Step 2.12: Atualizar CHANGELOG.md**

```
### Added
- Prontuário: linha do tempo visual vertical, adendos imutáveis por sessão, upload de anexos via Supabase Storage (bucket patient-documents). Arquivos: `src/components/MedicalRecord.jsx`, `supabase/medical_record_addenda_schema.sql`.
```

---

## Self-review

### Cobertura
- ✅ Linha do tempo (layout vertical com marcador circular)
- ✅ Evoluções com adendo (tabela separada, sem editar original)
- ✅ Anexos: upload + download via signed URL
- ✅ Sem DELETE (exigência CFM/LGPD preservada)

### Riscos
- `crypto.randomUUID()` não funciona em iOS Safari < 15.4 — alternativa: `Math.random().toString(36).slice(2)` + timestamp
- O bucket `patient-documents` precisa ser criado manualmente no dashboard antes do deploy
- O Storage RLS usa `storage.foldername()` — confirmar que a extensão `storage` está ativa no projeto Supabase

### Fora do escopo
- Preview inline de imagens (só abre em nova aba por enquanto)
- Categorização de anexos com label (campo existe na tabela mas UI não expõe)
