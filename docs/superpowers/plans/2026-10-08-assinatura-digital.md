# Assinatura Digital Fase 1 (Upload) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a clínica anexe documentos assinados digitalmente (TCLE, receitas, laudos) ao prontuário do paciente via upload de PDF. Fase 1 = upload do PDF já assinado externamente (sem integração com ICP-Brasil/BirdID).

**Architecture:** Reutiliza o bucket `patient-documents` e a tabela `patient_attachments` criados no plano `medical-record-timeline`. Adiciona uma seção dedicada no drawer do paciente com filtro por tipo de documento. O upload etiqueta os arquivos como `tcle_assinado`, `receita_assinada`, `laudo` etc.

**Pré-requisito:** O plano `2026-10-08-medical-record-timeline.md` deve estar implementado (bucket + tabela `patient_attachments` já existem).

**Tech Stack:** React 18, Supabase Storage, tabela `patient_attachments` (existente)

---

## Padrão e contexto (atualizado 2026-10-10)

> Alinha à spec de arquitetura `docs/superpowers/specs/2026-10-10-platform-architecture-design.md`. As Tasks abaixo continuam válidas.

**Contexto do cliente:** Fase 4. Fase 1 da assinatura = **upload do PDF já assinado externamente** (Assinador gov.br ou certificado da Dra.). Evolução = integração com provedor em nuvem (BirdID/Vidaas), condicionada à liberação e custo (contrato 12.3, Cláusula 8).

**Área e navegação:** área **Clínico → Documentos & assinatura**. Perfis clínicos.

**Benchmark (o que copiar):** fluxo simples de anexar o documento assinado ao prontuário, etiquetado por tipo.

**Modelo de dados e propagação:**
- Reusa `patient_attachments` + bucket `patient-documents`; etiqueta `tcle_assinado`, `receita_assinada`, `laudo`.
- **A plataforma não armazena o arquivo do certificado nem a senha** da Dra. (contrato 12.3).

**Permissões:** perfis clínicos.

**Checklist de fidedignidade (desta feature):**
1. O documento é anexado ao **paciente certo**, com o **tipo certo**, sem apagar anexos anteriores (archive-only).
2. Download devolve o arquivo íntegro (mesmo hash/tamanho do upload).
3. Isolado por paciente/clínica (RLS); só perfil clínico acessa.
4. Nunca pedir/guardar certificado ou senha na plataforma.
5. Teste cobre: upload → aparece no paciente com a etiqueta; download íntegro; acesso negado a perfil não-clínico.

---

## Referências obrigatórias

- `supabase/medical_record_addenda_schema.sql` — tabela `patient_attachments` e bucket `patient-documents`
- `src/components/Patients.jsx` — drawer onde a aba será adicionada
- `src/theme.js` — `C.text`, `C.surface`, `C.border`, `C.accent`, `C.textSub`, `C.green`

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---------|------|-----------------|
| `src/components/PatientDocuments.jsx` | Criar | Upload, listagem e download de documentos assinados |
| `src/components/Patients.jsx` | Modificar | Nova aba "Documentos" no drawer |

---

## Task 1: Componente `PatientDocuments.jsx`

**Files:**
- Create: `src/components/PatientDocuments.jsx`

- [ ] **Step 1.1: Criar o componente**

```jsx
import { useEffect, useRef, useState } from 'react'
import { C, base } from '../theme.js'
import { supabase } from '../lib/supabase.js'

const DOC_TYPES = [
  { value: 'tcle_assinado',    label: 'TCLE Assinado' },
  { value: 'receita_assinada', label: 'Receita Assinada' },
  { value: 'laudo',            label: 'Laudo / Exame' },
  { value: 'foto_pre_op',      label: 'Foto Pré-operatório' },
  { value: 'foto_pos_op',      label: 'Foto Pós-operatório' },
  { value: 'outro',            label: 'Outro' },
]

export function PatientDocuments({ patientId, userId }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [label, setLabel] = useState('tcle_assinado')
  const [customLabel, setCustomLabel] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    load()
  }, [patientId, userId])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('patient_attachments')
      .select('*')
      .eq('patient_id', patientId)
      .eq('user_id', userId)
      .is('record_id', null)   // documentos gerais, não vinculados a uma sessão
      .order('uploaded_at', { ascending: false })
    setDocs(data ?? [])
    setLoading(false)
  }

  async function handleFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''

    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${userId}/${patientId}/${crypto.randomUUID()}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('patient-documents')
      .upload(path, file, { contentType: file.type, upsert: false })

    if (!uploadErr) {
      const docLabel = label === 'outro' ? (customLabel.trim() || 'Documento') : (DOC_TYPES.find(t => t.value === label)?.label ?? label)
      await supabase.from('patient_attachments').insert({
        user_id: userId,
        patient_id: patientId,
        record_id: null,
        file_name: file.name,
        file_path: path,
        file_type: file.type,
        label: docLabel,
      })
      load()
    }
    setUploading(false)
  }

  async function openDoc(filePath) {
    const { data } = await supabase.storage
      .from('patient-documents')
      .createSignedUrl(filePath, 60 * 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteDoc(doc) {
    if (!window.confirm(`Remover "${doc.label}"? Esta ação não pode ser desfeita.`)) return
    await supabase.storage.from('patient-documents').remove([doc.file_path])
    await supabase.from('patient_attachments').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  function groupByLabel(docs) {
    const groups = {}
    for (const d of docs) {
      const key = d.label || 'Outros'
      if (!groups[key]) groups[key] = []
      groups[key].push(d)
    }
    return groups
  }

  const groups = groupByLabel(docs)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Upload */}
      <div style={{ background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 12, padding: 16 }}>
        <p style={{ fontSize: 12, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Enviar documento</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={label}
            onChange={e => setLabel(e.target.value)}
            style={{ ...base.input, width: 'auto', fontSize: 12, padding: '6px 10px' }}
          >
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>

          {label === 'outro' && (
            <input
              type="text"
              value={customLabel}
              onChange={e => setCustomLabel(e.target.value)}
              placeholder="Descrição do documento"
              style={{ ...base.input, width: 200, fontSize: 12, padding: '6px 10px' }}
            />
          )}

          <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFileChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || (label === 'outro' && !customLabel.trim())}
            style={{
              padding: '7px 16px', borderRadius: 8, background: C.accent, color: '#fff',
              border: 'none', fontSize: 12, cursor: 'pointer', fontWeight: 600,
              opacity: (uploading || (label === 'outro' && !customLabel.trim())) ? 0.6 : 1,
            }}
          >
            {uploading ? 'Enviando…' : '+ Enviar arquivo'}
          </button>
        </div>
        <p style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>PDF, JPG ou PNG · máx. 10 MB por arquivo</p>
      </div>

      {/* Listagem */}
      {loading ? (
        <p style={{ fontSize: 13, color: C.textDim }}>Carregando…</p>
      ) : docs.length === 0 ? (
        <p style={{ fontSize: 13, color: C.textDim, textAlign: 'center', padding: '24px 0' }}>Nenhum documento enviado ainda.</p>
      ) : (
        Object.entries(groups).map(([groupLabel, groupDocs]) => (
          <div key={groupLabel}>
            <p style={{ fontSize: 11, color: C.textSub, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>{groupLabel}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groupDocs.map(doc => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
                  <span style={{ fontSize: 18 }}>{doc.file_type?.includes('pdf') ? '📄' : '🖼️'}</span>
                  <span style={{ fontSize: 13, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name}</span>
                  <span style={{ fontSize: 11, color: C.textDim, flexShrink: 0 }}>
                    {new Date(doc.uploaded_at).toLocaleDateString('pt-BR')}
                  </span>
                  <button onClick={() => openDoc(doc.file_path)} style={{ background: 'none', border: `1px solid ${C.border}`, color: C.accent, fontSize: 11, borderRadius: 6, padding: '3px 10px', cursor: 'pointer', flexShrink: 0 }}>
                    Abrir
                  </button>
                  <button onClick={() => deleteDoc(doc)} style={{ background: 'none', border: 'none', color: C.textDim, fontSize: 11, cursor: 'pointer', flexShrink: 0 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
```

---

## Task 2: Aba "Documentos" no drawer de Patients

**Files:**
- Modify: `src/components/Patients.jsx`

- [ ] **Step 2.1: Adicionar "documentos" ao `DRAWER_TABS`**

```js
const DRAWER_TABS = ['resumo', 'pessoal', 'anamnese', 'prontuario', 'exames', 'receita', 'documentos', 'financeiro']
const DRAWER_TAB_LABELS = { ..., documentos: 'Documentos' }
```

- [ ] **Step 2.2: Importar `PatientDocuments` e renderizar**

```jsx
import { PatientDocuments } from './PatientDocuments.jsx'

{activeDrawerTab === 'documentos' && (
  <PatientDocuments
    patientId={selectedPatient.id}
    userId={user.id}
  />
)}
```

- [ ] **Step 2.3: Testar fluxo completo**

```bash
npm run dev
```

1. Abrir paciente → aba Documentos
2. Selecionar tipo "TCLE Assinado" → enviar um PDF
3. Confirmar que o arquivo aparece na lista agrupado por tipo
4. Clicar "Abrir" → confirmar que abre em nova aba (signed URL temporária)
5. Clicar "✕" → confirmar confirmação → arquivo removido da lista

- [ ] **Step 2.4: Commit**

```bash
git add src/components/PatientDocuments.jsx src/components/Patients.jsx
git commit -m "feat: upload de documentos assinados (TCLE, receita, laudo) no perfil do paciente"
```

- [ ] **Step 2.5: Atualizar CHANGELOG.md**

```
### Added
- Assinatura digital Fase 1: upload de PDFs assinados externamente (TCLE, receitas, laudos, fotos pré/pós-op) vinculados ao paciente, com agrupamento por tipo e download via signed URL. Arquivo: `src/components/PatientDocuments.jsx`.
```

---

## Self-review

### Cobertura
- ✅ Upload de PDFs e imagens por tipo de documento
- ✅ Listagem agrupada por tipo
- ✅ Download seguro via signed URL (1 hora de validade)
- ✅ Remoção com confirmação

### Riscos
- `window.confirm()` para confirmar remoção — bloqueia o thread; para UX mais limpa, substituir por um modal do sistema (`ConfirmModal` de `UI.jsx`) em versão futura
- O bucket `patient-documents` deve existir (pré-requisito: plano `medical-record-timeline`)
- Limite de 50 MB por arquivo no Supabase Storage free tier

### Fora do escopo
- Fase 2: integração com BirdID/Vidaas para assinatura ICP-Brasil dentro do sistema
- Preview inline de PDFs no browser
