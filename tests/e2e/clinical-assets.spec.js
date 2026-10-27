import { expect, test } from '@playwright/test'

const json = body => ({ status:200, contentType:'application/json', body:JSON.stringify(body) })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64')

test('envia, confirma, recarrega e arquiva foto clínica privada', async ({ page }) => {
  const assets = []
  const auditIds = []
  const rpcPayloads = []
  let uploadCount = 0

  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/rest/v1/**', route => route.fulfill(json([])))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill(json({ profile:{ doctor:{ fullName:'Dra. E2E', registrationId:'CRM-RS 1' } } })))
  await page.route('**/rest/v1/patients*', route => route.fulfill(json([{ id:'patient-assets', full_name:'Ana Imagens', date_of_birth:'1990-01-01', active:true }])))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill(json(null)))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill(json(true)))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/clinical_assets*', route => route.fulfill(json(assets)))
  await page.route('**/rest/v1/clinical_consent_acceptances*', route => route.fulfill(json([
    { id:'consent-image', title:'Uso de imagem clínica', accepted_at:'2026-10-20T12:00:00Z', respondent_name:'Ana Imagens' },
  ])))
  await page.route('**/rest/v1/rpc/create_clinical_asset_upload*', async route => {
    const body = await route.request().postDataJSON()
    rpcPayloads.push(body)
    await route.fulfill(json([{
      asset_id:'asset-photo',
      bucket_id:'clinical-assets',
      object_path:'e2e-user-id/patient-assets/asset-photo/original.png',
    }]))
  })
  await page.route('**/storage/v1/object/clinical-assets/**', async route => {
    uploadCount += 1
    await route.fulfill(json({ Key:'e2e-user-id/patient-assets/asset-photo/original.png' }))
  })
  await page.route('**/rest/v1/rpc/complete_clinical_asset_upload*', async route => {
    if (!assets.some(asset => asset.id === 'asset-photo')) {
      assets.unshift({
        id:'asset-photo', user_id:'e2e-user-id', patient_id:'patient-assets', created_by:'e2e-user-id',
        asset_kind:'clinical_photo', stage:'before', captured_on:'2026-10-22', region:'Abdômen',
        procedure_name:'Abdominoplastia', notes:'Registro pré-operatório', bucket_id:'clinical-assets',
        object_path:'e2e-user-id/patient-assets/asset-photo/original.png', file_name:'antes.png',
        expected_mime_type:'image/png', expected_file_size:PNG.length, observed_mime_type:'image/png',
        file_size:PNG.length, client_sha256:'a'.repeat(64), consent_acceptance_id:'consent-image',
        status:'available', created_at:'2026-10-22T12:00:00Z', completed_at:'2026-10-22T12:00:01Z',
        failed_at:null, archived_at:null,
      })
    }
    await route.fulfill(json(true))
  })
  await page.route('**/rest/v1/rpc/log_clinical_asset_access*', async route => {
    auditIds.push((await route.request().postDataJSON()).p_asset_id)
    await route.fulfill(json(true))
  })
  await page.route('**/rest/v1/rpc/log_clinical_asset_accesses*', async route => {
    const ids = (await route.request().postDataJSON()).p_asset_ids
    auditIds.push(...ids)
    await route.fulfill(json(ids.length))
  })
  await page.route('**/storage/v1/object/sign/clinical-assets', route => route.fulfill(json([
    { path:'e2e-user-id/patient-assets/asset-photo/original.png', signedURL:'/object/sign/clinical-assets/e2e-user-id/patient-assets/asset-photo/original.png?token=e2e' },
  ])))
  await page.route('**/storage/v1/object/sign/clinical-assets/**', route => route.request().method() === 'POST'
    ? route.fulfill(json({ signedURL:'/object/sign/clinical-assets/e2e-user-id/patient-assets/asset-photo/original.png?token=e2e' }))
    : route.fulfill({ status:200, contentType:'image/png', body:PNG }))
  await page.route('**/rest/v1/rpc/set_clinical_asset_archived*', async route => {
    const body = await route.request().postDataJSON()
    const asset = assets.find(item => item.id === body.p_asset_id)
    asset.status = body.p_archived ? 'archived' : 'available'
    asset.archived_at = body.p_archived ? '2026-10-22T12:10:00Z' : null
    await route.fulfill(json(true))
  })

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Imagens/ }).click()
  await page.getByRole('navigation', { name:'Ficha clínica do paciente' }).getByRole('button', { name:'Fotos e documentos', exact:true }).click()
  await expect(page.getByText('Comece registrando as fotos pré-procedimento')).toBeVisible()

  await page.getByRole('button', { name:'+ Adicionar fotos', exact:true }).first().click()
  await expect(page.getByText('Escolha ou arraste as fotos aqui')).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({ name:'antes.png', mimeType:'image/png', buffer:PNG })
  await expect(page.getByText('1 arquivo(s) pronto(s)')).toBeVisible()
  await page.getByLabel('Região').fill('Abdômen')
  await page.getByLabel('Procedimento').fill('Abdominoplastia')
  await page.getByLabel('Observação clínica').fill('Registro pré-operatório')
  await page.getByLabel('Aceite de uso de imagem relacionado').selectOption('consent-image')
  await page.getByRole('button', { name:'Salvar 1 foto(s)' }).click()

  await expect(page.getByText('Abdominoplastia').first()).toBeVisible()
  await expect(page.getByText('✓ Aceite de imagem vinculado')).toBeVisible()
  expect(uploadCount).toBe(1)
  expect(rpcPayloads[0]).toMatchObject({
    p_patient_id:'patient-assets',
    p_asset_kind:'clinical_photo',
    p_stage:'before',
    p_region:'Abdômen',
    p_procedure_name:'Abdominoplastia',
    p_consent_acceptance_id:'consent-image',
  })
  expect(rpcPayloads[0].p_client_sha256).toMatch(/^[0-9a-f]{64}$/)

  await page.reload()
  await page.getByRole('button', { name:/Ana Imagens/ }).click()
  await page.getByRole('navigation', { name:'Ficha clínica do paciente' }).getByRole('button', { name:'Fotos e documentos', exact:true }).click()
  await page.getByRole('button', { name:'Galeria de fotos' }).click()
  await expect(page.getByText('Abdominoplastia').first()).toBeVisible()
  await expect.poll(() => auditIds.filter(id => id === 'asset-photo').length).toBeGreaterThan(0)

  await page.getByRole('button', { name:'Visualizar' }).click()
  await expect(page.getByRole('dialog', { name:'Abdominoplastia' })).toBeVisible()
  await expect(page.getByRole('img', { name:'antes.png' })).toBeVisible()
  await page.getByRole('button', { name:'Fechar visualização' }).click()

  await page.getByRole('button', { name:'Arquivar' }).click()
  await expect(page.getByText('Nenhuma foto adicionada')).toBeVisible()
  await page.getByText('Mostrar arquivados').click()
  await expect(page.getByText('Arquivado', { exact:true })).toBeVisible()
  await page.getByRole('button', { name:'Restaurar' }).click()
  await expect(page.getByText('Disponível')).toBeVisible()
})

test('separa fotos de antes e depois e abre a comparação em tela cheia', async ({ page }) => {
  const baseAsset = {
    user_id:'e2e-user-id', patient_id:'patient-assets', created_by:'e2e-user-id', asset_kind:'clinical_photo',
    region:'Face', procedure_name:'Rinoplastia', notes:null, bucket_id:'clinical-assets', expected_mime_type:'image/png',
    expected_file_size:PNG.length, observed_mime_type:'image/png', file_size:PNG.length, client_sha256:'b'.repeat(64),
    consent_acceptance_id:null, status:'available', created_at:'2026-10-22T12:00:00Z', completed_at:'2026-10-22T12:00:01Z', failed_at:null, archived_at:null,
  }
  const assets = [
    { ...baseAsset, id:'photo-after', stage:'after', captured_on:'2026-10-22', object_path:'e2e-user-id/patient-assets/photo-after/original.png', file_name:'depois.png' },
    { ...baseAsset, id:'photo-before', stage:'before', captured_on:'2026-09-22', object_path:'e2e-user-id/patient-assets/photo-before/original.png', file_name:'antes.png' },
  ]

  await page.addInitScript(() => window.localStorage.setItem('surgimetrics_onboarded', 'true'))
  await page.route('**/rest/v1/**', route => route.fulfill(json([])))
  await page.route('**/api/secure-profile?action=get', route => route.fulfill(json({ profile:{} })))
  await page.route('**/rest/v1/patients*', route => route.fulfill(json([{ id:'patient-assets', full_name:'Ana Imagens', date_of_birth:'1990-01-01', active:true }])))
  await page.route('**/rest/v1/patient_clinical_profiles*', route => route.fulfill(json(null)))
  await page.route('**/rest/v1/rpc/log_clinical_record_access*', route => route.fulfill(json(true)))
  await page.route('**/rest/v1/medical_records*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/medical_record_addenda*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/clinical_assets*', route => route.fulfill(json(assets)))
  await page.route('**/rest/v1/clinical_consent_acceptances*', route => route.fulfill(json([])))
  await page.route('**/rest/v1/rpc/log_clinical_asset_accesses*', route => route.fulfill(json(2)))
  await page.route('**/rest/v1/rpc/log_clinical_asset_access*', route => route.fulfill(json(true)))
  await page.route('**/storage/v1/object/sign/clinical-assets', route => route.fulfill(json(assets.map(asset => ({ path:asset.object_path, signedURL:`/object/sign/clinical-assets/${asset.object_path}?token=e2e` })))))
  await page.route('**/storage/v1/object/sign/clinical-assets/**', route => route.request().method() === 'POST'
    ? route.fulfill(json({ signedURL:`${new URL(route.request().url()).pathname}?token=e2e` }))
    : route.fulfill({ status:200, contentType:'image/png', body:PNG }))

  await page.goto('/app/clinical-records')
  await page.getByRole('button', { name:/Ana Imagens/ }).click()
  await page.getByRole('navigation', { name:'Ficha clínica do paciente' }).getByRole('button', { name:'Fotos e documentos', exact:true }).click()

  const beforeSelect = page.getByLabel('Foto de antes')
  const afterSelect = page.getByLabel('Foto de depois')
  await expect(beforeSelect.locator('option')).toHaveCount(2)
  await expect(afterSelect.locator('option')).toHaveCount(2)
  const beforeImageButton = page.getByRole('button', { name:'Abrir foto de antes em tela cheia' })
  await expect(beforeImageButton).toBeVisible()
  await expect(page.getByRole('button', { name:'Abrir foto de depois em tela cheia' })).toBeVisible()
  await expect(beforeImageButton.locator('img')).toHaveCSS('object-fit', 'contain')
  expect((await beforeImageButton.boundingBox())?.height).toBeGreaterThan(250)

  await page.getByRole('button', { name:/Comparar em tela cheia/ }).click()
  const compareDialog = page.getByRole('dialog', { name:'Comparação antes e depois' })
  await expect(compareDialog).toBeVisible()
  await expect(compareDialog.getByRole('img', { name:'Antes: antes.png' })).toBeVisible()
  await expect(compareDialog.getByRole('img', { name:'Depois: depois.png' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name:'Comparação antes e depois' })).toBeHidden()
})
