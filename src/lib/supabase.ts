import { createClient } from '@supabase/supabase-js'


const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!


if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local')
}


export const supabase = createClient(supabaseUrl, supabaseKey)
