// DRAFT: Supabase Edge Function 'submit-mock-oral-giveaway'.
// Requires SUPABASE_SERVICE_ROLE_KEY, and deployment with
// verify_jwt=false so nonmembers can use the equal free direct-entry method.
import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
const ORIGIN='https://apexaviationtx.com';
const START=Date.parse('2026-10-21T16:00:00Z');
const END_EXCLUSIVE=Date.parse('2026-11-02T05:00:00Z'); // Nov 2, 00:00 EST.
const headers={ 'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'content-type,authorization,apikey','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json' };
const respond=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('',{headers});
 if(req.method!=='POST')return respond(405,{error:'Method not allowed'});
 if(Deno.env.get('MOCK_ORAL_GIVEAWAY_ENABLED')!=='true')return respond(503,{error:'Giveaway entries are not open yet'});
 if(req.headers.get('origin')!==ORIGIN)return respond(403,{error:'Invalid origin'});
 const now=Date.now();
 if(now<START || now>=END_EXCLUSIVE)return respond(403,{error:'The giveaway is not open for entries'});
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const url=Deno.env.get('SUPABASE_URL');
 if(!service||!url)return respond(503,{error:'Entry service not configured'});
 let input:any;
 try { if(Number(req.headers.get('content-length')||0)>8192)return respond(413,{error:'Payload too large'});input=await req.json();} catch{return respond(400,{error:'Invalid request'});}
 if(!input || typeof input!=='object')return respond(400,{error:'Invalid request'});
 const name=typeof input.first_name==='string'?input.first_name.trim():'';
 const email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
 const timing=String(input.checkride_timing||'');
 // A URL parameter is not evidence of assessment completion. Until signed server-side
 // assessment proof exists, ALL entries are treated as equal direct entries.
 const method='direct';
 if(name.length<1||name.length>80||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !['within_14_days','within_30_days','within_90_days','not_scheduled'].includes(timing)||input.rules_accepted!==true)return respond(400,{error:'Please complete all required fields and accept the rules'});
 // Both methods get exactly one entry. The assessment method is self-reported pending
 // verified assessment-session proof integration; DO NOT describe as verified completion.
 const supabase=createClient(url,service,{auth:{persistSession:false}});
 // Bound repeated submissions using HMAC-SHA256 keyed with the existing service role secret.
 // This does NOT prevent rotating-email bot submissions; add provider/network rate controls separately.
 const hmacKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(service),'HMAC',{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const digest=await crypto.subtle.sign('HMAC',hmacKey,new TextEncoder().encode('mock_oral_2026_oct:'+email));
 const emailHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const hourBucket=new Date(Math.floor(now/3600000)*3600000).toISOString();
 const {data:allowed,error:limitError}=await supabase.rpc('mock_oral_giveaway_take_rate_limit',{
   p_campaign:'mock_oral_2026_oct',p_email_hash:emailHash,p_bucket:hourBucket
 });
 if(limitError)return respond(503,{error:'Entry verification is unavailable. Please try again later.'});
 if(allowed!==true)return respond(429,{error:'Too many attempts. Please retry later.'});
 const {error}=await supabase.from('mock_oral_giveaway_entries').insert({
 campaign_id:'mock_oral_2026_oct',first_name:name,email,checkride_timing:timing,entry_method:method,
 assessment_completed:false,marketing_opt_in:input.marketing_opt_in===true,
 rules_accepted_at:new Date().toISOString()
 });
 if(error?.code==='23505')return respond(200,{ok:true,message:'An entry for this email is already recorded. Only one entry per person is permitted.'});
 if(error)return respond(503,{error:'Entry could not be saved. Please try again.'});
 return respond(200,{ok:true,message:'Your giveaway entry has been recorded.'});
});
