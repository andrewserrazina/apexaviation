import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NOTION_TOKEN = Deno.env.get('NOTION_TOKEN')
const NOTION_DATABASE_ID = Deno.env.get('NOTION_METRIC_SNAPSHOTS_DATABASE_ID')
const CRON_SECRET = Deno.env.get('ANDREWOS_CRON_SECRET