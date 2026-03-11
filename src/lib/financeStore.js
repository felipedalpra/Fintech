import { createEmptyData, isDataEmpty, normalizeData } from '../dataModel.js'
import { supabase } from './supabase.js'

const LEGACY_APP_KEY = 'startupfinance_v1'
const LOCAL_USERS_KEY = 'startupfinance_users_v1'
const LOCAL_DATA_PREFIX = 'startupfinance_user_data_v1'
const MIGRATION_PREFIX = 'startupfinance_migrated_user_v1'

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function migratedKey(userId) {
  return `${MIGRATION_PREFIX}:${userId}`
}

function getLocalUserDataByEmail(email) {
  const users = readJson(LOCAL_USERS_KEY, [])
  const matchedUser = users.find(user => user.email === email?.trim().toLowerCase())

  if (!matchedUser) return null

  return readJson(`${LOCAL_DATA_PREFIX}:${matchedUser.id}`, null)
}

export async function fetchFinanceData(userId) {
  const { data, error } = await supabase
    .from('user_finance_data')
    .select('payload')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error

  return normalizeData(data?.payload ?? createEmptyData())
}

export async function saveFinanceData(userId, financeData) {
  const payload = normalizeData(financeData)
  const { error } = await supabase
    .from('user_finance_data')
    .upsert(
      {
        user_id: userId,
        payload,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )

  if (error) throw error
}

export async function importLegacyDataIfNeeded(user) {
  const alreadyMigrated = localStorage.getItem(migratedKey(user.id)) === '1'
  const remoteData = await fetchFinanceData(user.id)

  if (!isDataEmpty(remoteData) || alreadyMigrated) {
    return remoteData
  }

  const localUserData = getLocalUserDataByEmail(user.email)
  const legacyAppData = readJson(LEGACY_APP_KEY, null)
  const importCandidate = !isDataEmpty(normalizeData(localUserData))
    ? localUserData
    : legacyAppData

  if (!importCandidate) {
    localStorage.setItem(migratedKey(user.id), '1')
    return remoteData
  }

  const normalized = normalizeData(importCandidate)
  if (isDataEmpty(normalized)) {
    localStorage.setItem(migratedKey(user.id), '1')
    return remoteData
  }

  await saveFinanceData(user.id, normalized)
  localStorage.setItem(migratedKey(user.id), '1')
  return normalized
}
