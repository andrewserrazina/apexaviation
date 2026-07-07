const requiredEnv = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
}

const missingEnv = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key)

if (missingEnv.length > 0) {
  throw new Error(`Missing required environment variable${missingEnv.length > 1 ? 's' : ''}: ${missingEnv.join(', ')}`)
}

export const config = {
  supabaseUrl: requiredEnv.VITE_SUPABASE_URL,
  supabaseAnonKey: requiredEnv.VITE_SUPABASE_ANON_KEY,
}
