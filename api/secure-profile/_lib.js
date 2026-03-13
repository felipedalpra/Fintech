import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const TABLE = 'secure_profiles'
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const encryptionKey = process.env.APP_DATA_ENCRYPTION_KEY

export function getServerSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase env not configured')
  return createClient(supabaseUrl, supabaseAnonKey)
}

export function getAdminSupabase() {
  if (!supabaseUrl || !supabaseServiceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth:{ persistSession:false, autoRefreshToken:false },
  })
}

export async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || req.headers.Authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) throw new Error('Missing bearer token')

  const supabase = getServerSupabase()
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) throw new Error('Invalid auth token')
  return data.user
}

export async function fetchEncryptedProfile(userId) {
  const admin = getAdminSupabase()
  const { data, error } = await admin.from(TABLE).select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function saveEncryptedProfile(userId, encryptedPayload, payloadMeta = {}) {
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from(TABLE)
    .upsert({
      user_id:userId,
      encrypted_payload:encryptedPayload,
      payload_version:1,
      payload_meta:payloadMeta,
      updated_at:new Date().toISOString(),
    }, { onConflict:'user_id' })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function insertProfileAuditLog(userId, action, payloadMeta = {}) {
  const admin = getAdminSupabase()
  const { error } = await admin.from('audit_logs').insert({
    user_id:userId,
    actor_id:userId,
    action,
    entity_type:'secure_profile',
    details:{
      doctor_fields:payloadMeta.doctorFields || 0,
      clinic_fields:payloadMeta.clinicFields || 0,
      has_logo:Boolean(payloadMeta.hasLogo),
    },
  })

  if (error && error.code !== '42P01') throw error
}

export function encryptPayload(payload) {
  if (!encryptionKey) throw new Error('APP_DATA_ENCRYPTION_KEY not configured')
  const iv = crypto.randomBytes(12)
  const key = crypto.createHash('sha256').update(encryptionKey).digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    iv:iv.toString('base64'),
    tag:tag.toString('base64'),
    data:ciphertext.toString('base64'),
  }
}

export function decryptPayload(encryptedPayload) {
  if (!encryptedPayload?.data) return null
  if (!encryptionKey) throw new Error('APP_DATA_ENCRYPTION_KEY not configured')

  const key = crypto.createHash('sha256').update(encryptionKey).digest()
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedPayload.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(encryptedPayload.tag, 'base64'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedPayload.data, 'base64')),
    decipher.final(),
  ])
  return JSON.parse(plaintext.toString('utf8'))
}

export function sanitizeProfilePayload(rawProfile = {}) {
  const doctor = rawProfile.doctor || {}
  const clinic = rawProfile.clinic || {}

  return {
    doctor:{
      fullName:trim(doctor.fullName),
      professionalTitle:trim(doctor.professionalTitle),
      specialty:trim(doctor.specialty),
      registrationId:trim(doctor.registrationId),
      phone:trim(doctor.phone),
      email:trim(doctor.email),
    },
    clinic:{
      legalName:trim(clinic.legalName),
      tradeName:trim(clinic.tradeName),
      documentId:trim(clinic.documentId),
      phone:trim(clinic.phone),
      email:trim(clinic.email),
      website:trim(clinic.website),
      addressLine:trim(clinic.addressLine),
      city:trim(clinic.city),
      state:trim(clinic.state),
      notes:trim(clinic.notes),
      logoDataUrl:validateLogo(clinic.logoDataUrl),
    },
  }
}

export function profileMeta(profile) {
  const doctorFields = Object.values(profile.doctor || {}).filter(Boolean).length
  const clinicFields = Object.entries(profile.clinic || {}).filter(([key, value]) => key !== 'logoDataUrl' && Boolean(value)).length
  return {
    doctorFields,
    clinicFields,
    hasLogo:Boolean(profile.clinic?.logoDataUrl),
  }
}

function trim(value) {
  return String(value || '').trim()
}

function validateLogo(value) {
  const next = trim(value)
  if (!next) return ''
  if (!next.startsWith('data:image/')) throw new Error('Formato de logo inválido.')
  if (next.length > 1_500_000) throw new Error('Logo muito grande. Use uma imagem menor.')
  return next
}
