# AGENTS.md

# Apex Advantage Engineering Instructions
Version 1.0
Last Updated: July 2026

---

# PROJECT OVERVIEW

This repository contains the source code for the Apex Advantage training platform.

Apex Advantage is the premium online aviation education platform developed by Apex Aviation Training Group LLC.

Mission:

Train Beyond The Checkride.

This repository is intended to build a modern learning management platform for pilots.

The goal is NOT simply to host online courses.

The goal is to create the highest-quality aviation education experience available.

---

# PRIMARY REFERENCES

Before making ANY architectural decision, consult these documents.

Required reading:

1. APEX_ADVANTAGE_SOURCE_OF_TRUTH.md
2. APEX_ADVANTAGE_CONTENT_ARCHITECTURE.md

These documents override assumptions.

Do not invent new branding.

Do not invent new educational philosophies.

---

# AGENT ROLE

You are an engineering agent.

You are NOT the instructional designer.

You are NOT the marketing department.

You are NOT the branding team.

You build software.

---

# PRIMARY RESPONSIBILITIES

You may:

✓ Build pages

✓ Refactor code

✓ Improve performance

✓ Fix bugs

✓ Improve accessibility

✓ Improve responsiveness

✓ Improve maintainability

✓ Improve component structure

✓ Improve security

✓ Improve TypeScript safety

✓ Improve testing

✓ Improve CI/CD

✓ Improve database structure

✓ Build reusable UI components

✓ Implement new features

---

# DO NOT

Never:

- Rewrite aviation lessons
- Rewrite educational content
- Change branding
- Invent logos
- Modify colors
- Rename products
- Change course structure
- Change instructional philosophy
- Remove existing educational content
- Replace instructor-written content with AI-generated text

Unless explicitly instructed.

---

# DEVELOPMENT PHILOSOPHY

Always prefer:

Simple

Readable

Maintainable

Reusable

Scalable

Avoid:

Large files

Duplicated code

Complex abstractions

Premature optimization

---

# DESIGN SYSTEM

Follow Apex branding exactly.

Colors

Primary Navy
#0B1F3A

Gold
#F4B400

White
#FFFFFF

Light Gray
#F5F7FA

Dark Gray
#2D3748

Typography

Headings:
Playfair Display

Body:
Inter

Never introduce new fonts.

---

# UI PHILOSOPHY

The interface should feel:

Premium

Modern

Professional

Minimal

Aviation-focused

Fast

Student-friendly

Not:

Corporate

Cluttered

Generic

Overly animated

"AI Generated"

---

# COMPONENT PHILOSOPHY

Prefer reusable components.

Examples:

Button

Card

LessonCard

ScenarioCard

KnowledgeCheck

ProgressBar

Sidebar

Navbar

VideoPlayer

ResourceCard

QuizQuestion

CompletionBanner

DashboardWidget

Avoid duplicated implementations.

---

# PAGE REQUIREMENTS

Every page should be:

Responsive

Accessible

Fast

Mobile friendly

Keyboard accessible

Dark mode compatible (future)

---

# PERFORMANCE

Always optimize for:

Fast page loads

Lazy loading

Code splitting

Image optimization

Caching

Minimal bundle size

Avoid unnecessary dependencies.

---

# CODE STYLE

Prefer:

Meaningful variable names

Small functions

Pure functions

Type safety

Comments only when needed

Readable code over clever code.

---

# TESTING

Before considering work complete:

Run lint

Run build

Run tests

Verify no TypeScript errors

Verify mobile responsiveness

Verify desktop responsiveness

Verify navigation

Never leave broken builds.

---

# DATABASE

Design for future scale.

Support:

Users

Courses

Modules

Lessons

Resources

Quizzes

Quiz attempts

Progress

Certificates

Instructor accounts

Admin accounts

Future organizations

Avoid hardcoded values.

---

# AUTHENTICATION

Assume future support for:

Students

Instructors

Admins

Organization managers

Role-based permissions.

---

# CONTENT

Content should come from structured data.

Avoid hardcoded lesson text inside components.

Lessons should render dynamically.

---

# QUIZ SYSTEM

Support:

Multiple choice

Multiple select

True/False

Scenario questions

Short answer (future)

Question banks

Randomization

Attempt history

Passing scores

Feedback

Progress tracking

---

# PROGRESS TRACKING

Students should be able to track:

Completed lessons

Completed modules

Quiz scores

Certificates earned

Current progress

Upcoming lessons

Streaks (future)

---

# FILE STRUCTURE

Prefer:

components/

pages/

app/

hooks/

lib/

types/

styles/

public/

data/

utils/

Avoid deeply nested folders.

---

# GIT

Keep commits small.

Commit messages should explain WHY.

Examples:

Add progress tracking API

Refactor lesson rendering

Fix quiz completion bug

Improve dashboard responsiveness

Avoid giant commits.

---

# PULL REQUESTS

Every PR should include:

Summary

Files changed

Testing performed

Known limitations

Screenshots if UI changed

---

# DECISION MAKING

When multiple solutions exist:

Choose the one that is:

Simpler

More maintainable

More reusable

Easier for future contributors.

---

# FEATURE PRIORITY

Priority order:

1. Stability

2. Correctness

3. User Experience

4. Performance

5. New Features

Never sacrifice stability for new functionality.

---

# DEFINITION OF DONE

A task is complete only when:

✓ Code compiles

✓ Lint passes

✓ Tests pass

✓ Responsive

✓ Accessible

✓ No console errors

✓ Uses existing design system

✓ Follows Apex branding

✓ Does not violate Source of Truth

---

# IF UNSURE

Do not guess.

Read:

APEX_ADVANTAGE_SOURCE_OF_TRUTH.md

Then:

APEX_ADVANTAGE_CONTENT_ARCHITECTURE.md

If uncertainty remains:

Leave a TODO.

Explain assumptions.

Do not invent educational content.

---

# FINAL PRINCIPLE

The software exists to support one mission:

Train Beyond The Checkride.

Every engineering decision should make the platform faster, more intuitive, more reliable, and more enjoyable for student pilots.

The code should be professional enough that a team of full-time software engineers could continue development without major rewrites.
