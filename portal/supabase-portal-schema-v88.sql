-- Apex Advantage — Ground School Module Companion + scored Knowledge
-- Check quizzes (v88)
--
-- Ships the real Module 1 ("Becoming a Pilot") student-workbook content
-- into the portal, and the schema needed for every future module's
-- workbook to slot in the same way. Two genuinely different content
-- shapes here, gated the same way DPE content already is:
--
-- 1. module_companion_content -- the read-only workbook material
--    (objectives, guided-notes prompts, key concepts, the scenario
--    worksheet, Checkride Corner questions, the Apex Challenge). This is
--    real, paid curriculum IP, so it's locked admin-only at the RLS
--    layer -- same precedent as dpe_categories/dpe_questions
--    (supabase-portal-schema-v5.sql's own comment: "nothing should ever
--    write to these tables from a client... except through a future
--    admin CMS"). The only way a student ever sees it is through the new
--    get-module-companion-content Edge Function, which verifies real
--    entitlement server-side before returning anything -- never trusting
--    the client's own hasModuleAccess() convenience check.
--
-- 2. module_quiz_questions / module_quiz_attempts -- the new, genuinely
--    different content type: a real SCORED end-of-module quiz (15
--    questions, multiple choice/short answer/scenario, with an answer
--    key), as opposed to guided_notes' free-text-only, no-correct-answer
--    shape. Questions are admin-only at rest (same reasoning as above)
--    and served, correct answers included, through the same Edge
--    Function -- this is self-study material a paying student is meant
--    to see the answer key for, the same trust model DPE_DATA's model_
--    answer already uses, not a proctored exam needing server-side
--    grading. module_quiz_attempts records what the student actually
--    answered and scored, own-row RLS, for progress tracking.
--
-- guided_notes itself (v14) is unchanged in shape, just opened past the
-- admin-only preview policy -- exactly the single-line change that
-- migration's own header comment already called for, now that real
-- content exists to open it to. Existing prompt_ids for PPL-M01 in
-- GUIDED_NOTES_MODULES (site/portal-stable.js) predate this migration
-- and used a different module_id convention than the rest of the
-- codebase (PPL-M01-Becoming-a-Pilot vs. the real PPL-M01 used by
-- privatePilotCurriculum.js and every entitlement check) -- harmless
-- while the feature was admin-only, but wrong once hasModuleAccess()
-- needs to match it; fixed in the same application-code change that
-- introduces this content.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v87.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Open guided_notes to real students (documented single-line change)
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "Admins manage their own guided notes (feature-gated)" on public.guided_notes;
create policy "Users manage their own guided notes"
  on public.guided_notes for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Module Companion content (read-only workbook material)
-- ═══════════════════════════════════════════════════════════════════════

create table public.module_companion_content (
  course_id   text not null,
  module_id   text not null,
  content     jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (course_id, module_id)
);

alter table public.module_companion_content enable row level security;

create policy "Admins can manage module companion content"
  on public.module_companion_content for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M01',
  '{
    "modulePurpose": "Orient the student to the certification path, the learning model they''re entering, and the mindset of professional pilots — before a single regulation or system is taught.",
    "objectives": [
      { "id": "obj-eligibility", "label": "Describe the eligibility requirements and pathway for a Private Pilot Certificate" },
      { "id": "obj-part61-141", "label": "Differentiate Part 61 vs. Part 141 training and explain how Apex''s program fits within Part 61" },
      { "id": "obj-roles", "label": "Explain the roles of the FAA, DPE, and CFI in the certification process" },
      { "id": "obj-experience", "label": "Identify the required aeronautical experience for the Private Pilot Certificate" },
      { "id": "obj-tests", "label": "Describe the structure of the Knowledge Test and the Practical Test (oral + flight)" },
      { "id": "obj-acs", "label": "Explain the purpose and structure of the ACS and how it will be used throughout the course" },
      { "id": "obj-goals", "label": "Articulate personal training goals and identify obstacles likely to derail them" }
    ],
    "guidedNotes": [
      { "id": "eligibility-certificates", "section": "Eligibility & Certificates", "prompt": "To be eligible for a Private Pilot Certificate, what are the age, English-language, and medical requirements — and how do a student pilot certificate and a medical certificate differ as two separate documents?" },
      { "id": "part-61-vs-141", "section": "Part 61 vs. Part 141", "prompt": "What does a Part 141 school''s FAA-approved structured syllabus offer that Part 61 doesn''t, and what does Part 61 (Apex''s model) offer in return — especially for working adults and career-changers?" },
      { "id": "aeronautical-experience", "section": "Required Aeronautical Experience", "prompt": "What is the regulatory minimum total flight time for a Private Pilot Certificate, and how does that compare to the realistic national average?" },
      { "id": "roles", "section": "Roles", "prompt": "What does the FAA do, what does an independent, FAA-designated DPE do, and what does your CFI do to get you ready for that checkride?" },
      { "id": "the-acs", "section": "The ACS", "prompt": "How is the ACS organized — Areas of Operation breaking down into what, and what three elements does every one of those contain?" }
    ],
    "keyConcepts": [
      { "id": "acs", "term": "ACS (Airman Certification Standards)", "definition": "The FAA''s official standard defining the knowledge, risk management, and skill required for a certificate or rating, and the basis for both the Knowledge Test and the Practical Test." },
      { "id": "dpe", "term": "DPE (Designated Pilot Examiner)", "definition": "An individual designated by the FAA, independent of any flight school, authorized to administer practical tests (checkrides)." },
      { "id": "iacra", "term": "IACRA", "definition": "The FAA''s Integrated Airman Certification and Rating Application — the online system used to apply for certificates and ratings." },
      { "id": "basicmed", "term": "BasicMed", "definition": "An alternative to holding a traditional FAA medical certificate for certain private pilot operations, based on a physician''s exam and an online medical course." },
      { "id": "aktr", "term": "AKTR (Airman Knowledge Test Report)", "definition": "The official report issued after the Knowledge Test, listing ACS codes for any missed subject areas." },
      { "id": "pic", "term": "PIC (Pilot in Command)", "definition": "The person who has final authority and responsibility for the operation and safety of the flight." }
    ],
    "scenario": {
      "narrative": "A career-changer in their 40s tells you they''ve always dreamed of flying. They''re excited but anxious — they''re not sure if it''s \"too late\" to start, and they don''t know whether they should train at a Part 61 school like Apex or look for a Part 141 program instead. They have a stable job, a family, and roughly 6–8 hours a week they could realistically dedicate to training.",
      "prompts": [
        { "id": "scenario-whats-happening", "prompt": "What''s actually happening here?" },
        { "id": "scenario-first-response", "prompt": "What would you tell them first?" },
        { "id": "scenario-part61-141", "prompt": "What does Part 61 vs. Part 141 actually mean for someone in this exact situation?" },
        { "id": "scenario-classmates", "prompt": "What I heard from classmates that I hadn''t considered:" }
      ]
    },
    "checkrideCorner": [
      { "id": "cc-1", "question": "What are the eligibility requirements to apply for a Private Pilot Certificate?" },
      { "id": "cc-2", "question": "What is the difference between a student pilot certificate and a medical certificate?" },
      { "id": "cc-3", "question": "Walk me through what happens on your checkride day, start to finish." },
      { "id": "cc-4", "question": "What is the ACS, and how is it different from the older Practical Test Standards?" },
      { "id": "cc-5", "question": "What is the difference between Part 61 and Part 141 training?" }
    ],
    "knowledgeCheckQuestions": [
      { "id": "kcq-1", "prompt": "Name the four basic eligibility requirements for a Private Pilot Certificate." },
      { "id": "kcq-2", "prompt": "What is the minimum medical certificate class required, and what alternative exists?" },
      { "id": "kcq-3", "prompt": "List two structural differences between Part 61 and Part 141 training." },
      { "id": "kcq-4", "prompt": "Who is responsible for writing and enforcing federal aviation regulations?" },
      { "id": "kcq-5", "prompt": "What does \"independent\" mean in the context of a DPE''s role?" },
      { "id": "kcq-6", "prompt": "What are the three elements found within every ACS Task?" },
      { "id": "kcq-7", "prompt": "What document do you receive after taking the Knowledge Test, and what does it show you?" },
      { "id": "kcq-8", "prompt": "Name the four stages of checkride day in order." }
    ],
    "reflectionQuestions": [
      { "id": "reflect-1", "prompt": "What''s the single biggest obstacle that could realistically derail your training, and what''s one concrete step you could take this month to guard against it?" },
      { "id": "reflect-2", "prompt": "Where in your life have you already succeeded at a long, multi-stage goal? What made that work, and how could you apply it to flight training?" },
      { "id": "reflect-3", "prompt": "Now that you understand the FAA / DPE / CFI relationship, has your mental picture of \"who''s grading me\" changed at all? How?" }
    ],
    "apexChallenge": {
      "instructions": "Write a one-page personal training plan. Include: your target checkride date, your realistic weekly study/flight hours, and the single biggest risk to finishing on schedule — plus one concrete step you''ll take to manage that risk. This isn''t about being perfect; it''s about starting your training with a plan, not just a hope.",
      "fields": [
        { "id": "target-date", "label": "Target Checkride Date", "type": "date" },
        { "id": "weekly-hours", "label": "Weekly Study Hours (realistic, not aspirational)", "type": "text" },
        { "id": "biggest-risk", "label": "Biggest Risk to Finishing on Schedule", "type": "textarea" },
        { "id": "mitigation-plan", "label": "My Plan to Manage That Risk", "type": "textarea" }
      ]
    }
  }'::jsonb
)
on conflict (course_id, module_id) do update set content = excluded.content, updated_at = now();

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Scored Knowledge Check quiz
-- ═══════════════════════════════════════════════════════════════════════

create table public.module_quiz_questions (
  id              text primary key,
  course_id       text not null,
  module_id       text not null,
  sort_order      int not null,
  question_type   text not null check (question_type in ('multiple_choice', 'short_answer', 'scenario')),
  prompt          text not null,
  choices         jsonb,
  correct_choice  text,
  model_answer    text not null,
  created_at      timestamptz not null default now()
);

alter table public.module_quiz_questions enable row level security;

create policy "Admins can manage module quiz questions"
  on public.module_quiz_questions for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

create index module_quiz_questions_module_idx on public.module_quiz_questions (course_id, module_id, sort_order);

create table public.module_quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  course_id     text not null,
  module_id     text not null,
  answers       jsonb not null,
  score         int not null,
  total         int not null,
  completed_at  timestamptz not null default now()
);

alter table public.module_quiz_attempts enable row level security;

create policy "Users manage their own module quiz attempts"
  on public.module_quiz_attempts for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

create index module_quiz_attempts_profile_module_idx on public.module_quiz_attempts (profile_id, course_id, module_id);

insert into public.module_quiz_questions (id, course_id, module_id, sort_order, question_type, prompt, choices, correct_choice, model_answer) values
('PPL-M01-Q01', 'PPL', 'PPL-M01', 1, 'multiple_choice', 'The minimum age to apply for a Private Pilot Certificate is:',
  '[{"key":"A","label":"16"},{"key":"B","label":"17"},{"key":"C","label":"18"},{"key":"D","label":"21"}]'::jsonb, 'B',
  '17 is the minimum age to hold a Private Pilot Certificate; 16 is the minimum age to solo, a common point of confusion.'),
('PPL-M01-Q02', 'PPL', 'PPL-M01', 2, 'multiple_choice', 'Which of the following is required to administer a Practical Test?',
  '[{"key":"A","label":"Any CFI with 500+ hours"},{"key":"B","label":"An FAA-Designated Pilot Examiner (DPE)"},{"key":"C","label":"The chief instructor of the flight school"},{"key":"D","label":"An FAA Inspector only"}]'::jsonb, 'B',
  'The DPE is independent of the flight school, which protects the integrity of the standard.'),
('PPL-M01-Q03', 'PPL', 'PPL-M01', 3, 'short_answer', 'Name the two main portions of the Practical Test.',
  null, null,
  'The oral exam and the flight (skill) portion. Both are formal, graded components of the same Practical Test.'),
('PPL-M01-Q04', 'PPL', 'PPL-M01', 4, 'multiple_choice', 'BasicMed is best described as:',
  '[{"key":"A","label":"An exemption from ever needing a medical exam"},{"key":"B","label":"An alternative to a traditional FAA medical certificate for certain operations, requiring a physician''s exam and an online course"},{"key":"C","label":"A medical certificate only available to airline pilots"},{"key":"D","label":"A waiver process used only for color-blindness"}]'::jsonb, 'B',
  'BasicMed is a defined alternative pathway with its own requirements — not a blanket exemption from medical oversight.'),
('PPL-M01-Q05', 'PPL', 'PPL-M01', 5, 'short_answer', 'What is the difference between Part 61 and Part 141 flight training?',
  null, null,
  'Part 141 follows an FAA-approved structured syllabus and can allow a lower minimum hour total; Part 61 (Apex''s model) offers more scheduling flexibility, often suited to working adults. Neither is universally "better" — the right fit depends on the student''s timeline and learning style.'),
('PPL-M01-Q06', 'PPL', 'PPL-M01', 6, 'multiple_choice', 'The ACS differs from the older PTS primarily because the ACS:',
  '[{"key":"A","label":"Removed the oral exam entirely"},{"key":"B","label":"Integrates knowledge and risk-management elements directly into each Task alongside skill"},{"key":"C","label":"Only applies to commercial pilots"},{"key":"D","label":"Eliminated ACS codes"}]'::jsonb, 'B',
  'The ACS''s defining structural change is integrating Knowledge and Risk Management directly into each Task alongside Skill.'),
('PPL-M01-Q07', 'PPL', 'PPL-M01', 7, 'short_answer', 'What document is issued after the Knowledge Test, and what information does it contain?',
  null, null,
  'The Airman Knowledge Test Report (AKTR), which lists ACS codes for any missed subject areas. Those codes map directly to specific ACS Tasks, allowing targeted review.'),
('PPL-M01-Q08', 'PPL', 'PPL-M01', 8, 'scenario', 'A student tells you their flight instructor will be administering their checkride. What''s inaccurate about this statement, and why does it matter?',
  null, null,
  'It''s inaccurate because a DPE, not the instructor, administers the checkride. This matters because the DPE''s independence is what makes the certification standard meaningful and trustworthy — a common and important misconception to correct early.'),
('PPL-M01-Q09', 'PPL', 'PPL-M01', 9, 'multiple_choice', 'The regulatory minimum total flight time for a Private Pilot Certificate under Part 61 is:',
  '[{"key":"A","label":"35 hours"},{"key":"B","label":"40 hours"},{"key":"C","label":"50 hours"},{"key":"D","label":"60 hours"}]'::jsonb, 'B',
  'Per 61.109, though the realistic national average completion time is meaningfully higher.'),
('PPL-M01-Q10', 'PPL', 'PPL-M01', 10, 'short_answer', 'List the four stages of checkride day in order.',
  null, null,
  'Document review, oral exam, flight portion, debrief. Knowing the full sequence (not just the flight portion) reduces checkride-day anxiety.'),
('PPL-M01-Q11', 'PPL', 'PPL-M01', 11, 'multiple_choice', 'Within an ACS Task, the three elements tested are:',
  '[{"key":"A","label":"Knowledge, Risk Management, Skill"},{"key":"B","label":"Ground, Flight, Oral"},{"key":"C","label":"Pre-flight, In-flight, Post-flight"},{"key":"D","label":"Regulatory, Practical, Written"}]'::jsonb, 'A',
  'This three-part structure is unique to the ACS and is the foundation for how oral exams are now structured.'),
('PPL-M01-Q12', 'PPL', 'PPL-M01', 12, 'scenario', 'A 45-year-old career-changer asks whether Part 61 or Part 141 is "better." What''s the most accurate response?',
  null, null,
  'Neither is universally better — the right answer depends on the student''s schedule, budget, and learning style; both paths lead to the same certificate. Rewards nuanced, situational reasoning over absolute claims.'),
('PPL-M01-Q13', 'PPL', 'PPL-M01', 13, 'short_answer', 'What does IACRA stand for, and what is it used for?',
  null, null,
  'Integrated Airman Certification and Rating Application — the FAA''s online system for applying for certificates and ratings, and for scheduling the Knowledge Test.'),
('PPL-M01-Q14', 'PPL', 'PPL-M01', 14, 'scenario', 'A student misses several questions on their Knowledge Test, all coded to weather-related ACS Tasks. What should their study plan look like before the checkride, and why?',
  null, null,
  'Focus review specifically on the ACS Tasks tied to those missed weather codes, using the actual ACS language, rather than broadly re-studying all weather material. Targeted, ACS-literate review is more efficient and is exactly the skill this module is designed to build.'),
('PPL-M01-Q15', 'PPL', 'PPL-M01', 15, 'multiple_choice', 'If an applicant does not meet the standard on one Task during a checkride, the examiner issues a:',
  '[{"key":"A","label":"Full retest requirement from the beginning"},{"key":"B","label":"Notice of Disapproval for that specific task"},{"key":"C","label":"Automatic certificate denial for one year"},{"key":"D","label":"Referral to an FAA Inspector"}]'::jsonb, 'B',
  'The applicant can retrain and retest on just the deficient area(s), not the entire exam.');
