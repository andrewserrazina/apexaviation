-- Apex Advantage — Module Workbook content: Module 2 (Aerodynamics) (v89)
--
-- Same schema as v88 (module_companion_content, keyed by course_id +
-- module_id) -- no new tables or application code needed, since
-- get-module-companion-content and portal-stable.js's Module Workbook
-- rendering are already generic over whichever module has a row here.
--
-- Unlike Module 1's package, this Module 2 production package's own
-- Part 10 (Post-Class Email) and Part 11 (Knowledge Check / Assessment
-- Bank) sections are headers only, with no body content underneath --
-- confirmed by re-extracting the source PDF twice (with and without
-- layout mode) to rule out a text-flow artifact. No scored quiz is
-- seeded for PPL-M02 as a result: inventing 15 questions and an answer
-- key with no source material would be fabrication, not authoring, the
-- same standard the Module 1 package's own "flagged for future
-- authoring rather than fabricated here" convention (its ACS Alignment/
-- Completion Standards sections) already set. module_quiz_questions
-- simply has no PPL-M02 rows; get-module-companion-content already
-- returns an empty quiz array in that case, and the Module Workbook page
-- already renders no quiz section when the array is empty -- no code
-- changes needed to accommodate a module with no quiz yet.
--
-- Guided Notes below reuse the 6 synthesis-style prompts already seeded
-- as GUIDED_NOTES_MODULES' PPL-M02 placeholder (site/portal-stable.js) --
-- checked against this real package's 6 Guided Notes pages (Four Forces;
-- How Lift Is Generated; Angle of Attack & Critical AoA; Load Factor &
-- Accelerated Stalls; Drag; Stability & Control) and found to already
-- accurately synthesize each page's real content, so they're carried
-- into the real content here rather than rewritten from scratch.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v88.

insert into public.module_companion_content (course_id, module_id, content) values (
  'PPL', 'PPL-M02',
  '{
    "modulePurpose": "Build a practical understanding of how and why airplanes fly, how lift is generated, and how aerodynamic principles directly affect aircraft performance, stability, control, and safe decision making.",
    "objectives": [
      { "id": "obj-four-forces", "label": "Explain the four forces of flight" },
      { "id": "obj-bernoulli-newton", "label": "Describe Bernoulli''s Principle and Newton''s Third Law as they relate to lift" },
      { "id": "obj-aoa", "label": "Define angle of attack" },
      { "id": "obj-critical-aoa", "label": "Explain critical angle of attack" },
      { "id": "obj-stalls", "label": "Describe stalls from an aerodynamic perspective" },
      { "id": "obj-load-factor", "label": "Explain load factor and accelerated stalls" },
      { "id": "obj-drag", "label": "Describe drag and the difference between induced and parasite drag" },
      { "id": "obj-lift-drag", "label": "Interpret the lift/drag relationship" },
      { "id": "obj-stability", "label": "Explain stability and controllability" },
      { "id": "obj-apply", "label": "Apply aerodynamic concepts to real-world flight situations" }
    ],
    "guidedNotes": [
      { "id": "four-forces", "section": "The Four Forces", "prompt": "What are the four forces of flight, and what does it mean for them to be in balance during steady, unaccelerated flight?" },
      { "id": "lift-generation", "section": "How Lift Is Generated", "prompt": "How do Bernoulli''s Principle and Newton''s Third Law each explain lift, and why are both considered valid rather than competing explanations?" },
      { "id": "angle-of-attack", "section": "Angle of Attack & Critical AoA", "prompt": "What is angle of attack, how does it differ from pitch attitude, and what happens at the critical angle of attack?" },
      { "id": "load-factor", "section": "Load Factor & Accelerated Stalls", "prompt": "How does load factor relate to angle of attack in a turn, and why does stall speed increase as bank angle increases? Why does Va decrease as aircraft weight decreases below max gross weight?" },
      { "id": "drag", "section": "Drag", "prompt": "What is the difference between parasite drag and induced drag, and what does the point of minimum total drag (L/D-max) correspond to?" },
      { "id": "stability-control", "section": "Stability & Control", "prompt": "What is the difference between static and dynamic stability, and what are the three axes of stability and their controls?" }
    ],
    "scenario": {
      "narrative": "You''re a low-time private pilot flying the pattern at your home airport on a calm, clear afternoon — nothing unusual, just a routine flight with a friend in the right seat. You''re on the base leg, a little higher and a little faster than you meant to be, and you turn final a beat later than you should have. As you roll out, you realize you''ve overshot the extended runway centerline — you''re lined up with the taxiway, not the runway. Your friend is chatting, unaware anything''s off. The runway is right there. You''re relaxed, this is your home airport, you''ve landed here a hundred times. You tighten your bank to correct back to centerline, without touching the throttle or the pitch — it feels like a small adjustment, the kind you''ve made a dozen times before. What happens next, aerodynamically, depends entirely on what you do in the next three seconds.",
      "prompts": [
        { "id": "scenario-initial-decision", "prompt": "My Initial Decision: what would you do in the next three seconds?" },
        { "id": "scenario-classmates", "prompt": "What I Heard From Classmates that I hadn''t considered:" },
        { "id": "scenario-after-discussion", "prompt": "My Decision After Discussion:" },
        { "id": "scenario-pave-pilot", "prompt": "Risk Analysis — Pilot: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-pave-aircraft", "prompt": "Risk Analysis — Aircraft: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-pave-environment", "prompt": "Risk Analysis — enVironment: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-pave-external", "prompt": "Risk Analysis — External Pressures: how does this PAVE element apply to this scenario?" },
        { "id": "scenario-change-decision", "prompt": "What would change my decision — what''s the specific threshold that would flip you from \"correct back to centerline\" to \"go around\"?" },
        { "id": "scenario-confidence", "prompt": "How confident do you feel applying this reasoning on a real flight, and why?" }
      ]
    },
    "checkrideCorner": [
      { "id": "cc-1", "question": "What are the four forces of flight?" },
      { "id": "cc-2", "question": "What is angle of attack?" },
      { "id": "cc-3", "question": "What is a stall?" },
      { "id": "cc-4", "question": "What two principles explain how a wing generates lift?" },
      { "id": "cc-5", "question": "What is the difference between parasite drag and induced drag?" },
      { "id": "cc-6", "question": "What is critical angle of attack, and why does it matter?" },
      { "id": "cc-7", "question": "What is load factor, and how does it relate to bank angle?" },
      { "id": "cc-8", "question": "What is an accelerated stall?" },
      { "id": "cc-9", "question": "What is Va, and why does it change with weight?" },
      { "id": "cc-10", "question": "What is the difference between static and dynamic stability?" },
      { "id": "cc-11", "question": "Why does an airplane stall at a higher airspeed in a steep turn than in level flight?" },
      { "id": "cc-12", "question": "Explain the aerodynamic reasoning behind the base-to-final stall/spin accident pattern." },
      { "id": "cc-13", "question": "How do total drag, parasite drag, and induced drag relate to best glide speed?" },
      { "id": "cc-14", "question": "Why do flaps increase both lift and drag, and what tradeoff does that create?" },
      { "id": "cc-15", "question": "How would you explain, aerodynamically, why an airplane can be fully controllable during a stall in some cases but enter a spin in others?" }
    ],
    "reflectionQuestions": [
      { "id": "reflect-1", "prompt": "What''s the one thing from tonight you''re most likely to remember a year from now?" },
      { "id": "reflect-2", "prompt": "Areas to Improve: where do I want to focus more before Module 3?" },
      { "id": "reflect-3", "prompt": "Questions Remaining: what''s still unclear or unresolved from tonight?" }
    ],
    "apexChallenge": {
      "instructions": "\"My Personal Va\" — Using your training aircraft''s POH, calculate Va at max gross weight and at your typical solo training weight (your weight plus roughly half fuel, no passenger). Then write a short response addressing three things: (1) What are the two numbers, and why are they different? (2) Describe a specific real flight scenario — not necessarily dramatic — where knowing your actual, weight-adjusted Va (not just the number on the placard) would change a decision you make in the airplane. (3) Connect your answer to tonight''s Scenario Workshop: how does understanding Va change how you''d think about the \"steep turn to final\" situation we discussed? Submission requires both Va calculations shown with the specific POH page/chart referenced, and a written response of at least 200 words.",
      "fields": [
        { "id": "va-max-gross", "label": "Va at Max Gross Weight (with POH page/chart reference)", "type": "text" },
        { "id": "va-solo-weight", "label": "Va at Typical Solo Training Weight (with POH page/chart reference)", "type": "text" },
        { "id": "written-response", "label": "Written Response (at least 200 words — the two Va numbers and why they differ, a real flight scenario, and the connection to tonight''s Scenario Workshop)", "type": "textarea" }
      ]
    }
  }'::jsonb
)
on conflict (course_id, module_id) do update set content = excluded.content, updated_at = now();
