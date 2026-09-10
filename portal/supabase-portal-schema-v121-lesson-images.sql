-- ═══════════════════════════════════════════════════════════════════════
-- v121: Study Pack lesson illustrations + entitlement-check RLS fix
-- ═══════════════════════════════════════════════════════════════════════
--
-- Two related additions to the study-pack-resources bucket (v99):
--
-- 1. Lesson illustrations. Every pack's frozen content ships a
--    graphics_manifest describing a set of images, but nothing ever
--    served them -- the Lesson Renderer has been text-only for every
--    Study Pack. New path convention (same private/entitlement-gated
--    shape as quick-reference/<pack_id>/... and
--    certificates/<profile_id>/<pack_id>.pdf):
--      lesson-images/<pack_id>/<asset_id>.png
--    Resolution is by convention only -- the client already has pack_id
--    and graphics_manifest[].asset_id from get-study-pack-content, and
--    signs the URL with its own session via storage.createSignedUrl().
--    No new Edge Function or content-schema change needed. An asset not
--    yet uploaded 404s on createSignedUrl and the client just skips it.
--
-- 2. Dormant RLS bug fix. public.has_study_pack_entitlement(uuid, text)
--    has EXECUTE revoked from anon/authenticated by design -- an
--    authenticated user must not be able to probe an arbitrary OTHER
--    profile_id's entitlement via a direct RPC call (confirmed by the
--    Weather Mastery launch security tests, T3). The existing
--    "quick-reference" storage policy below calls that function directly
--    inside its USING clause, which Postgres evaluates as the requesting
--    role -- so with no EXECUTE grant, that policy has been silently
--    un-callable (permission denied) since v99 shipped. It was never
--    caught because V1 never uploads a quick-reference file there (it's
--    rendered as an in-portal page instead, per the v99 comment).
--
--    Fixed with a SECURITY DEFINER wrapper that hardcodes auth.uid() as
--    the subject, so granting EXECUTE on it cannot be used to query
--    anyone else's entitlement -- unlike the underlying function, it
--    takes no profile_id argument at all. Both the quick-reference policy
--    and the new lesson-images policy use this wrapper from the start.

create or replace function public.has_study_pack_entitlement_self(p_pack_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.has_study_pack_entitlement(auth.uid(), p_pack_id);
$$;

grant execute on function public.has_study_pack_entitlement_self(text) to authenticated;

drop policy if exists "Owners can read study pack quick reference" on storage.objects;
create policy "Owners can read study pack quick reference"
  on storage.objects for select
  using (
    bucket_id = 'study-pack-resources'
    and (storage.foldername(name))[1] = 'quick-reference'
    and public.has_study_pack_entitlement_self((storage.foldername(name))[2])
  );

create policy "Owners can read study pack lesson images"
  on storage.objects for select
  using (
    bucket_id = 'study-pack-resources'
    and (storage.foldername(name))[1] = 'lesson-images'
    and public.has_study_pack_entitlement_self((storage.foldername(name))[2])
  );

update storage.buckets
  set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
  where id = 'study-pack-resources';
