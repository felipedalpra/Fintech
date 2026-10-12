import { useEffect, useState } from 'react'
import { C, base } from '../theme.js'
import { Btn, FInput, Modal } from './UI.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useUserRole } from '../context/UserRoleContext.jsx'

// Seleciona (ou cadastra na hora) um fornecedor normalizado. Mesmo padrão do PatientSelector.
// onChange(id, name) — o chamador guarda o id (vínculo) e o nome (snapshot).
// Resolve o dono da clínica sozinho (ownerId) para não exigir prop nova de quem usa.
export function SupplierSelector({ userId, value, onChange, label = 'Fornecedor' }) {
  const { user } = useAuth()
  const { ownerId } = useUserRole()
  const effectiveUserId = userId || ownerId || user?.id
  const [suppliers, setSuppliers] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', document: '', phone: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!effectiveUserId) return
    supabase.from('suppliers').select('id,name,document,phone').eq('user_id', effectiveUserId).eq('active', true).order('name')
      .then(({ data }) => setSuppliers(data || []))
  }, [effectiveUserId])

  async function createSupplier() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    const { data: created } = await supabase.from('suppliers').insert({
      user_id: effectiveUserId,
      name: form.name.trim(),
      document: form.document || null,
      phone: form.phone || null,
    }).select('id,name,document,phone').single()
    setSaving(false)
    if (created) {
      setSuppliers(s => [...s, created].sort((a, b) => a.name.localeCompare(b.name)))
      onChange(created.id, created.name)
      setShowCreate(false)
      setForm({ name: '', document: '', phone: '' })
    }
  }

  const selected = suppliers.find(s => s.id === value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={base.label}>{label}</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={value || ''}
          onChange={e => {
            const s = suppliers.find(sup => sup.id === e.target.value)
            onChange(e.target.value, s?.name || '')
          }}
          style={{ ...base.input, flex: 1 }}
        >
          <option value="">Selecionar fornecedor cadastrado…</option>
          {suppliers.map(s => (
            <option key={s.id} value={s.id}>{s.name}{s.document ? ` · ${s.document}` : ''}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          style={{
            background: C.accent + '18', color: C.accent, border: `1px solid ${C.accent}44`,
            borderRadius: 8, padding: '0 14px', height: 38, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          + Novo
        </button>
      </div>
      {selected && (
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
          {[selected.phone, selected.document].filter(Boolean).join(' · ')}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Cadastrar fornecedor" width={440}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FInput label="Nome / Razão social" required value={form.name}
            onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Nome do fornecedor" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <FInput label="CNPJ/CPF (opcional)" value={form.document}
              onChange={v => setForm(f => ({ ...f, document: v }))} placeholder="00.000.000/0000-00" />
            <FInput label="Telefone (opcional)" value={form.phone}
              onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="(11) 99999-9999" />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
            <Btn variant="ghost" onClick={() => setShowCreate(false)}>Cancelar</Btn>
            <Btn onClick={createSupplier} disabled={saving || !form.name.trim()}>
              {saving ? 'Criando…' : 'Criar e selecionar'}
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  )
}
