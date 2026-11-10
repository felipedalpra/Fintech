import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { renderDocumentForSignature } from '../../api/_lib/clinicalSignatureBry.js'

const migration = fs.readFileSync(path.resolve('supabase/clinical_asset_signature_bridge.sql'), 'utf8')

test('ponte de assinatura valida escopo, autoria, PDF e cria snapshot idempotente', () => {
  expect(migration).toContain("asset.created_by = auth.uid()")
  expect(migration).toContain("asset.status = 'available'")
  expect(migration).toContain("asset.observed_mime_type = 'application/pdf'")
  expect(migration).toContain('on conflict (source_asset_id)')
  expect(migration).toContain("'sha256', target.client_sha256")
  expect(migration).toContain('grant execute on function public.prepare_clinical_asset_signature(uuid) to authenticated')
})

test('backend envia os bytes originais somente quando tamanho e hash conferem', async () => {
  const bytes = Buffer.from('%PDF-1.4\nconteudo-testado')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const asset = {
    id:'asset-1', user_id:'owner-1', patient_id:'patient-1', created_by:'doctor-1',
    asset_kind:'document', status:'available', bucket_id:'clinical-assets', object_path:'owner-1/patient-1/asset-1/original.pdf',
    observed_mime_type:'application/pdf', file_size:bytes.length, client_sha256:sha256,
  }
  const query = {
    select() { return this }, eq() { return this },
    async maybeSingle() { return { data:asset, error:null } },
  }
  const admin = {
    from() { return query },
    storage:{ from:() => ({ download:async () => ({ data:new Blob([bytes]), error:null }) }) },
  }
  const result = await renderDocumentForSignature({
    document_type:'uploaded_pdf', source_asset_id:'asset-1', user_id:'owner-1', patient_id:'patient-1', created_by:'doctor-1',
  }, { admin })
  expect(result.buffer.equals(bytes)).toBe(true)
  expect(result.sha256).toBe(sha256)

  asset.client_sha256 = '0'.repeat(64)
  await expect(renderDocumentForSignature({
    document_type:'uploaded_pdf', source_asset_id:'asset-1', user_id:'owner-1', patient_id:'patient-1', created_by:'doctor-1',
  }, { admin })).rejects.toThrow(/diverge/)
})
