// Private operator tool. Execute only after approved Official Rules specify eligibility.
// Usage: deno run --allow-env --allow-net scripts/review-mock-oral-entry.ts <entry-uuid> <eligible|ineligible> <review-note>
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GIVEAWAY_REVIEWER_ID
// Never run in browsers. Keep private entrant data out of logs and PR comments.
import {createClient} from 'npm:@supabase/supabase-js@2.57.0';
const [id,status,note]=Deno.args;
const reviewer=Deno.env.get('GIVEAWAY_REVIEWER_ID');
const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key||!reviewer)throw Error('Missing privileged configuration');
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))throw Error('Specify a valid entry UUID');
if(status!=='eligible'&&status!=='ineligible')throw Error('Status must be eligible or ineligible');
if(!note||note.trim().length<8||note.length>250)throw Error('Provide a concise review rationale (8-250 characters)');
const sb=createClient(url,key,{auth:{persistSession:false}});
const {data,error}=await sb.from('mock_oral_giveaway_entries')
 .update({eligibility_status:status,eligibility_reviewed_at:new Date().toISOString(),eligibility_reviewed_by:reviewer,eligibility_review_note:note.trim()})
 .eq('id',id).eq('campaign_id','mock_oral_2026_oct').eq('eligibility_status','pending')
 .select('id,eligibility_status').maybeSingle();
if(error)throw Error('Eligibility update failed: '+error.message);
if(!data)throw Error('Entry not found or already reviewed; no changes made');
console.log(JSON.stringify({id:data.id,status:data.eligibility_status,reviewer}));
