// Run by an authorized operator ONLY after the giveaway closes.
// Required environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Usage: deno run --allow-env --allow-net scripts/draw-mock-oral-giveaway.ts
// This tool READS the entry table; it never updates customer data or contacts a winner.
// Preserve the JSON output privately as drawing evidence; do not publish entrant emails.
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key)throw Error('Missing private Supabase environment variables');
if(Date.now()<Date.parse('2026-11-02T05:00:00Z'))throw Error('Drawing must take place after entries close');
if(Deno.env.get('GIVEAWAY_ELIGIBILITY_REVIEW_COMPLETE')!=='yes')throw Error('A documented eligibility review is required before drawing');
const client=createClient(url,key,{auth:{persistSession:false}});
type Entry={id:string;email:string;created_at:string;campaign_id:string;eligibility_status:string};
const entrants:Entry[]=[];
const PAGE_SIZE=1000;
for(let offset=0;;offset+=PAGE_SIZE){
 const {data,error}=await client.from('mock_oral_giveaway_entries')
   .select('id,email,created_at,campaign_id,eligibility_status')
   .eq('campaign_id','mock_oral_2026_oct')
   .eq('eligibility_status','eligible')
   .gte('created_at','2026-10-22T16:00:00.000Z')
   .lt('created_at','2026-11-02T05:00:00.000Z')
   .order('id',{ascending:true})
   .range(offset,offset+PAGE_SIZE-1);
 if(error)throw Error('Entry retrieval failed: '+error.message);
 entrants.push(...(data||[]));
 if(!data||data.length<PAGE_SIZE)break;
}
if(entrants.length===0)throw Error('No eligible-timestamp entries. No winner drawn.');
// Only admin-reviewed eligible entries are returned. Keep audit of manual review separate.
// IMPORTANT: complete manual eligibility/identity review must occur BEFORE running
// this drawing, or filter exclusions through an approved auditable record.
// No purchases or assessment scores used in selection.
const limit=Math.floor(0x100000000/entrants.length)*entrants.length;
if(entrants.length>0x100000000)throw Error('Entrant count too large for this draw');
let random=0;
do {const arr=new Uint32Array(1);crypto.getRandomValues(arr);random=arr[0];}while(random>=limit);
const picked=entrants[random%entrants.length];
const print={campaign:'mock_oral_2026_oct',drawn_at:new Date().toISOString(),eligible_count:entrants.length,
 winning_entry_id:picked.id,winning_email:picked.email,random_source:'Web Crypto getRandomValues Uint32 rejection sampling',
 note:'Operator must verify winner eligibility before notification; this script does not send or reserve prize'};
console.log(JSON.stringify(print,null,2));
