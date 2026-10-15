import { expect, test } from '@playwright/test'
import { deriveCalendarAccess, googleEventIdForRecord } from '../../api/_lib/googleCalendarApi.js'

test('owner administra a conexão compartilhada da própria clínica', () => {
  expect(deriveCalendarAccess('owner-1', {
    ownedClinic:{ id:'clinic-1', owner_id:'owner-1' },
  })).toEqual({
    ownerId:'owner-1',
    clinicId:'clinic-1',
    role:'admin',
    isOwner:true,
    canManage:true,
  })
})

test('admin membro usa o owner como escopo e pode gerenciar a conexão', () => {
  expect(deriveCalendarAccess('member-admin', {
    membership:{ clinic_id:'clinic-1', role:'admin' },
    memberClinic:{ id:'clinic-1', owner_id:'owner-1' },
  })).toMatchObject({ ownerId:'owner-1', clinicId:'clinic-1', role:'admin', isOwner:false, canManage:true })
})

test('demais perfis usam a mesma conexão sem poder conectar ou desconectar', () => {
  for (const role of ['gestao', 'concierge', 'equipe']) {
    expect(deriveCalendarAccess(`member-${role}`, {
      membership:{ clinic_id:'clinic-1', role },
      memberClinic:{ id:'clinic-1', owner_id:'owner-1' },
    })).toMatchObject({ ownerId:'owner-1', clinicId:'clinic-1', role, isOwner:false, canManage:false })
  }
})

test('conta legada sem clínica mantém o próprio escopo', () => {
  expect(deriveCalendarAccess('legacy-user')).toMatchObject({ ownerId:'legacy-user', role:'admin', isOwner:true, canManage:true })
})

test('id do evento é estável por clínica e registro e válido para o Google', () => {
  const first = googleEventIdForRecord('owner-1', 'consultation', 'record-1')
  expect(first).toBe(googleEventIdForRecord('owner-1', 'consultation', 'record-1'))
  expect(first).not.toBe(googleEventIdForRecord('owner-2', 'consultation', 'record-1'))
  expect(first).not.toBe(googleEventIdForRecord('owner-1', 'surgery', 'record-1'))
  expect(first).toMatch(/^[0-9a-v]{5,1024}$/)
})
