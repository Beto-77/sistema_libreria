import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

export async function checkSupabaseConnection() {
  if (!supabase) return { connected: false, reason: 'missing-config' }
  const { error } = await supabase.auth.getSession()
  return { connected: !error, reason: error?.message }
}