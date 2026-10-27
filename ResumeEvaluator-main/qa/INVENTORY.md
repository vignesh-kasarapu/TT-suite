# QA Inventory — Acceptance Criteria & Edge Cases

Scope: full user-facing surface of the Resume Evaluation System, tested against the local
docker-compose stack (nginx:80, backend:8000, postgres, frontend) with sanitized synthetic
data (see `backend/scripts/gen_synthetic_data.py`). Not run against production; no real
candidate PII used.

Roles: `admin`, `recruiter`, `hiring_manager`, `interviewer`, `candidate`.

Known synthetic QA accounts (local only, not real people):
- admin: `mounish.k@tektalis.com` (existing seed)
- recruiter1@tektalis-test.local / recruiter2@tektalis-test.local — role `recruiter`
- hiring.manager1@tektalis-test.local — role `hiring_manager`
- interviewer1@tektalis-test.local / interviewer2@tektalis-test.local — role `interviewer`
- candidate.portal.qa@tektalis-test.local — role `candidate`, linked Candidate row
- password for all of the above except admin: `QaTest!2026`

---

## 0. Cross-cutting acceptance criteria (apply everywhere)

- AC0.1 Every authenticated route requires a valid, non-expired, non-revoked JWT; missing/invalid token → 401, not a silent empty page.
- AC0.2 Every admin-only backend endpoint (per API map) rejects non-admin callers with 403, regardless of what the frontend nav shows/hides.
- AC0.3 Destructive actions (hard delete, bulk delete, "delete all", GDPR erase) require explicit confirmation in the UI and are irreversible only via those explicit paths — no accidental single click destroys data.
- AC0.4 Every list/table page has a defined loading state, a defined empty state, and (per the frontend-inventory notes) either a defined error state or a documented reason one isn't needed.
- AC0.5 Optimistic UI updates (archive/delete rollback patterns) restore prior state on request failure.

Risk-based edge cases to probe under AC0 (not per-page, applies broadly):
- E0.1 Hit an admin-only API path (`/audit-log`, `/admin/gdpr/*`, `/admin/users`, etc.) directly with a recruiter/interviewer/hiring_manager/candidate token — expect 403 except where the API map says otherwise (`audit.py`'s `GET /audit-log` has **no** role check server-side — verify whether that's intended).
- E0.2 Expired/revoked access token on a mutating call (e.g. after logout) — expect 401, not a stale success.
- E0.3 Double-submit a destructive action rapidly (double-click delete) — expect idempotent result (second call 404s cleanly), not a 500 or duplicate side effect.
- E0.4 Network/API failure mid-optimistic-update (simulate via invalid ID) — UI should roll back, not leave a "ghost" row.

---

## 1. Auth & session (`/login`, `/candidate/login`, NavBar change-password, logout)

AC:
- AC1.1 Valid email+password → access+refresh token, redirect by role (candidate → `/candidate/dashboard`, else → `/leaderboard`).
- AC1.2 Invalid credentials → visible error, no token stored, no redirect.
- AC1.3 `change-password` requires correct current password; success logs the user out (per NavBar/Users duplicated logic) and redirects to `/login`.
- AC1.4 `forgot-password` always returns a generic message regardless of whether the email exists (anti-enumeration) and does not error when SMTP is unset.
- AC1.5 Refresh-token rotation: reusing an already-rotated (single-use) refresh token is rejected (401), not silently accepted.
- AC1.6 Logout revokes the current access token's jti (and refresh token if supplied) — a captured pre-logout token cannot be replayed afterward.

Edge cases:
- E1.1 Login with email in different case (`Admin@X.com` vs stored `admin@x.com`) — verify case-insensitive match or a clear rejection, not a confusing 401.
- E1.2 5 rapid failed logins from the same IP → 429 on the 6th (rate limit `/auth/login` = 5/min) — verify the UI surfaces this distinctly from "wrong password."
- E1.3 Password-reset token reused a second time → rejected (single-use enforced).
- E1.4 Password-reset token used after 1-hour TTL → rejected with a clear expiry message, not a generic 400.
- E1.5 `change-password` with `new_password` identical to `current_password` — confirm whether accepted or rejected, and that behavior is intentional.
- E1.6 Candidate account deactivated (`is_active=False`, e.g. after `DELETE /candidate/account`) attempts login → 401/403, not a partial session.

---

## 2. Admin: Users (`/users`, `/admin/users/*`)

AC:
- AC2.1 Admin can create a user (role recruiter/admin/hiring_manager/interviewer); email is sent if SMTP configured, failure is non-fatal to account creation.
- AC2.2 Admin cannot delete themself or the last remaining admin (400 per API map).
- AC2.3 Revoke toggles `is_active`; a revoked user cannot log in or use existing tokens (verify existing token also rejected, not just future logins).
- AC2.4 Reset-password generates a new temp password and (attempts to) email it; old password stops working immediately.
- AC2.5 Permission patch (`can_export`, `can_delete`, etc.) is rejected (422) when targeting an admin account (admins implicitly have all perms).

Edge cases:
- E2.1 Create a user with an email that already exists → 400, no duplicate row, no partial user created.
- E2.2 Revoke → Restore → Revoke in quick succession (no confirm dialog on this action per frontend inventory) — verify final DB state matches final UI toggle, no race leaves it out of sync.
- E2.3 Non-admin (recruiter/interviewer) calls `POST /admin/users` directly → 403.
- E2.4 Delete the second-to-last admin, then attempt to delete the last admin → second attempt blocked.
- E2.5 Self-targeting `/admin/users/{own_id}/revoke` or `DELETE` → 400 blocked, and the "you" row in the UI has no action buttons.

---

## 3. Job Roles / Configure (`/configure`, `/jobs/new`, `/job-roles/*`)

AC:
- AC3.1 Weights (`weight_projects+weight_skills+weight_education`) must equal exactly 100 or the API returns 422 — verify the auto-redistributing sliders in Configure never let a save request leave the server with a non-100 sum.
- AC3.2 Deleting a job role cascades to its requirements/skills associations (not orphaned rows) and removes it from `selectedJobRoleId` app state if it was selected.
- AC3.3 Pausing intake stops new evaluations from scoring (`eval_status='queued'` held); resuming re-queues them as a background job.
- AC3.4 Requirements-mode weight total must be within 0.5 of 100 to save (looser tolerance than the 3-bucket weights).
- AC3.5 JD auto-extract (paste or file) populates title/experience/skills without requiring a page reload, and a failed extraction shows an inline error without silently clearing already-entered fields.
- AC3.6 Closing an intake automatically via `closes_at` in the past is reflected as paused on both `/configure` and the public `/jobs` board.

Edge cases:
- E3.1 Save weights that sum to 99 or 101 via a direct API call (bypassing the UI's auto-redistribute) → 422, not silently accepted.
- E3.2 Requirements list totalling 100.6 (outside the 0.5 tolerance) → rejected; 100.4 → accepted.
- E3.3 Create a job role referencing a `skill_id` that doesn't exist → 404, no partial role created.
- E3.4 Set `min_graduation_year` > `max_graduation_year` — UI shows inline warning (per inventory) but does it block Save server-side too, or does an inconsistent range silently persist?
- E3.5 Salary min > salary max — no cross-validation noted anywhere; verify what actually happens end to end (stored as-is? rejected?).
- E3.6 Pause intake, then apply via candidate portal to that role → 409 per API map; verify the portal shows a clear "not accepting applications" state rather than a raw error.
- E3.7 Two admins edit the same job role concurrently (last-write-wins expected, since there's no optimistic locking) — verify no crash, just last save wins.

---

## 4. Upload & resume ingestion (`/upload`, `/upload/*`)

AC:
- AC4.1 Only PDF/DOCX/DOC accepted, validated by magic bytes + extension, not just extension (renaming a .txt to .pdf should be rejected).
- AC4.2 `consent_given=false` (or omitted) → 422 citing GDPR Article 13, no candidate/resume record created.
- AC4.3 File exceeding `MAX_UPLOAD_MB` (20MB default) → 413, no partial upload persisted.
- AC4.4 Near-duplicate resume (SimHash Hamming distance ≤3 vs. an existing current resume) → `duplicate_status="duplicate"`/`"near_duplicate"`, no new Candidate/Resume rows created for an exact/near dup.
- AC4.5 Candidate matching (email → resume-embedded email → phone → normalized name, in that order) correctly attaches a new resume version to an existing candidate rather than creating a duplicate person.
- AC4.6 Archive (`/upload/{id}/archive`) is soft (candidate hidden if no other active version) and reversible in principle (data not deleted); hard delete (`DELETE /upload/{id}`) removes DB rows and files and clears simhash to avoid false-dupe on re-upload.
- AC4.7 `DELETE /upload` (delete-all) requires the confirm dialog wired up in the UI — verify there is no route to trigger it without confirmation, given the API itself takes no confirmation param.
- AC4.8 Bulk import (`/upload/bulk-import`) only fills currently-empty fields on matched existing candidates — it must not overwrite populated fields.

Edge cases:
- E4.1 Upload a scanned-image PDF with no extractable text — parser should flag "OCR Required" / low layout confidence rather than silently producing an empty resume.
- E4.2 Upload the same real file twice with different candidate_name/email each time — verify dedup fires on content similarity, not name/email.
- E4.3 Upload 35 resumes back-to-back as one admin session inside 60s — the 30/min `/upload` rate limit should return 429 with `Retry-After`; verify the Upload page surfaces this clearly instead of looking like a stuck spinner (this reproduced during synthetic data seeding — confirm real recruiters bulk-uploading a large batch would hit the same wall).
- E4.4 Upload a resume whose embedded email differs from the `candidate_email` form field — verify which one wins for candidate matching, and that it's consistent with AC4.5's stated precedence.
- E4.5 Archive the only active resume version for a candidate → candidate should become soft-deleted per AC4.6; verify it disappears from default candidate lists but is still restorable.
- E4.6 Delete a resume version that has evaluations attached — verify evaluations are cascade-deleted (per API map) and don't linger as orphaned rows visible in `/results`.
- E4.7 `resegment-all` on a resume with heavily nonstandard section headers (typos, non-English) — verify the 4-pass segmenter (heuristic → lexicon → Levenshtein ≤2 → embedding cosine ≥0.70) recovers at least the common sections; check `sections_detected` isn't empty for a well-formed resume.

---

## 5. Evaluation pipeline (`/evaluate/*`, Configure "Run Evaluation", Leaderboard actions)

AC:
- AC5.1 Running evaluation against a paused-intake role leaves resumes `queued` and does not score them until resumed.
- AC5.2 Evaluation dedups by candidate_id/email/phone so the same person isn't scored twice for one role from two resume versions — the newer version wins.
- AC5.3 Auto-shortlist fires only when `min_fit_score` is configured and a score meets/exceeds it; auto-email fires only when `auto_email_enabled` and score ≥85.
- AC5.4 Auto-pause triggers exactly when `shortlist_target` qualifying candidates have accumulated, not before or after.
- AC5.5 `GET /evaluate/status` accurately reflects `in_progress` — a UI polling loop relying on this (e.g. Configure's progress bar) must observe it flip to false when scoring actually finishes, not before.
- AC5.6 Pausing an in-progress evaluation run stops it after the current resume (not mid-resume, not requiring a hard kill).

Edge cases:
- E5.1 Run evaluation on a role with 0 matching resumes (all filtered by experience/level pre-filter) — expect `queued_count=0`, `job_id="none"`, and a clear "No resumes matched" UI message (per Configure's documented state), not a silent no-op.
- E5.2 Trigger `/evaluate` twice in quick succession for the same role before the first finishes — verify no duplicate Evaluation rows (unique constraint `job_role_id+resume_id` should 409/skip cleanly, not 500).
- E5.3 A candidate with `graduation_year` outside an entry-level role's `[min_graduation_year, max_graduation_year]` — verify Stage-0 filter excludes them and the reason surfaces as `filter_stage="experience_filtered"` (or similar) in results, not just a missing row with no explanation.
- E5.4 `require_github=true` role scoring a candidate with no `github_url` — verify they're flagged (not silently scored as if GitHub were optional) per "Missed Requirement: GitHub."
- E5.5 Rerun (`/evaluate/rerun`) after weights changed on the role — verify scores actually change to reflect the new weights, not stale cached values.
- E5.6 `send-next-steps` called twice for the same evaluation without `force=true` — second call should skip (no duplicate email), matching the documented behavior.

---

## 6. Results / Leaderboard (`/leaderboard`, `/results/*`, `/candidates/*`)

AC:
- AC6.1 Sorting, filtering (status/experience/location/grad-year/score/YOE), and search combine correctly (AND semantics) and reset pagination to page 1 when filters change.
- AC6.2 Shortlist/Review/Reject actions append a new Shortlist row (history-preserving); the "current status" shown is always the most recent row, not overwritten history.
- AC6.3 Bulk actions (shortlist/reject/delete) apply to exactly the selected set, and "Compare" is only enabled with exactly 2 selected.
- AC6.4 Manual evaluation override (0–100 slider + skills checklist + notes) persists and is reflected wherever the "official" score is displayed elsewhere (or clearly labeled as a separate override if it isn't blended in).
- AC6.5 Blind mode consistently masks candidate name/email/PDF-preview/GitHub badges across every view it claims to cover (table, buckets) — no leak in one view while another is masked.
- AC6.6 CSV/HTML export reflects the currently applied filters for "Export filtered" and ignores them for "Export All."
- AC6.7 Soft-deleted candidates are excluded from `/results`, `/candidates/search`, and the Leaderboard by default, and reappear correctly after `/restore`.

Edge cases:
- E6.1 Apply a filter combination that matches zero results — verify an explicit "no results" state, not a blank table indistinguishable from a loading state.
- E6.2 Sort by a score column while a "What-If" sandbox re-ranking is active — verify which score is actually being sorted (live DB score or sandbox-simulated score) and that this is not ambiguous to the user.
- E6.3 Select 2 candidates from different job roles and hit "Compare" — verify this is either blocked or handled sensibly (comparison endpoint doesn't scope by role).
- E6.4 Delete a candidate's only evaluation while their row is currently open in the Manual Evaluation panel — verify the panel doesn't crash and either closes or shows a clear error on save.
- E6.5 Hit `DELETE /results/all?job_role_id=` for a role with 200+ evaluations — verify it completes without timing out and the Leaderboard reflects the empty state afterward (regression risk given the earlier documented "don't drop loaded pages on refocus" bug-fix comment in the code).
- E6.6 Stage transition via the inline `<select>` on a stage not in the documented enum (tamper with the request) → 422 (results.py's regex-enforced) vs. `PATCH /candidates/{id}` (no stage validation per API map) — verify the two stage-update paths don't produce inconsistent states.
- E6.7 Export CSV with 0 matching rows — verify a valid (header-only) CSV, not a 500 or an empty response with wrong content-type.

---

## 7. Candidate collaboration: Comments, Interview Feedback, Shortlist notes

AC:
- AC7.1 Only the comment/feedback author or an admin can edit/delete it (403 otherwise) — verify this is enforced server-side, not just hidden in the UI.
- AC7.2 Comment/feedback body length limits (1–4000 chars for comments) are enforced server-side, not just via a UI `maxLength`.
- AC7.3 Deleting a candidate (soft or hard) correctly cascades or orphans comments/feedback in a defined way — verify which, since the frontend doesn't show a warning about this side effect.

Edge cases:
- E7.1 Recruiter A posts a comment; Recruiter B (non-admin) attempts to edit/delete it directly via API → 403.
- E7.2 Post a comment with exactly 4000 chars (boundary) and 4001 chars (over) — verify accept/reject boundary matches the documented limit.
- E7.3 Submit interview feedback with `rating` outside 1–5 (e.g. 0 or 6) via direct API call bypassing the UI's constrained `<select>` → expect 422.
- E7.4 Delete interview feedback as the interviewer who created it, then attempt the same delete again → second call 404 (not 500).

---

## 8. GDPR / Data Retention (`/gdpr`, `/admin/gdpr/*`) — **admin only server-side, but the page has no client-side gate**

AC:
- AC8.1 Retention settings changes (days, retain-hired-forever, anonymize-vs-delete, delete-evaluations) persist and are reflected on next page load.
- AC8.2 `run-retention` defaults to `dry_run=true` — a dry run must never mutate data; only an explicit `dry_run=false` call does.
- AC8.3 `retain_hired_forever=true` genuinely excludes `stage=hired` candidates from deletion/anonymization even if they're older than `retention_days`.
- AC8.4 Anonymize-on-delete and auto-delete-evaluations are mutually exclusive in the UI (delete-evaluations disabled when anonymize is on) — verify the backend also refuses/ignores an inconsistent combination sent directly via API, not just the UI toggle state.
- AC8.5 A non-admin visiting `/gdpr` directly gets a clean, understandable error (403 surfaced sensibly), not a raw stack trace or an infinite loading spinner (flagged in frontend inventory as "no error state defined for settings-fetch failure").

Edge cases:
- E8.1 Run a dry scan, confirm `candidates_processed` matches expectation, then run for real and confirm the actual deleted/anonymized counts match the dry run's numbers (no drift between preview and execution).
- E8.2 Erase a candidate manually (`DELETE /candidates/{id}/erase`, admin-only) who also has interview feedback and comments — verify anonymization doesn't leave a comment thread still showing their real name pulled from elsewhere.
- E8.3 Set `retention_days=30` (the documented minimum) and verify the UI's client clamp actually matches the server's accepted minimum (no off-by-one mismatch).

---

## 9. Audit Log (`/audit`, `/audit-log`) — **no role check at all server-side per the API map**

AC:
- AC9.1 Every logged mutation (create/update/delete/restore/stage_change) that other routers claim to audit actually produces a row with a correct `user_id`, `action`, `target_type/id`.
- AC9.2 Filtering by target_type/target_id/action narrows results correctly; pagination totals match the filtered count, not the global count.

Edge cases:
- E9.1 **Security check**: log in as `interviewer1@tektalis-test.local` and call `GET /audit-log` directly — per the API map this endpoint has no role restriction. Confirm whether a non-admin can read the full audit trail (including other users' actions) and treat as a genuine access-control finding if so, not just a UI nav-hiding issue.
- E9.2 An action performed by a now-deleted user — verify the log row survives (`user_id` SET NULL per FK) and displays gracefully rather than crashing the diff renderer.
- E9.3 A `details` JSON blob that fails to parse — verify the "graceful fallback for non-JSON details" mentioned in the frontend inventory actually renders something sane, not blank space.

---

## 10. Skills taxonomy (`/skills`, Configure's Skills Board)

AC:
- AC10.1 Skill names are unique (409 on exact-match duplicate creation).
- AC10.2 JD-extraction auto-creates only skills it actually matched from the ~90-skill dictionary/alias table, not arbitrary noise words.
- AC10.3 Deleting a skill cascades its `job_role_skills` associations (roles don't retain a dangling reference).

Edge cases:
- E10.1 Create a skill with only-whitespace or with different casing of an existing skill ("python" vs "Python") — verify whether this is treated as a duplicate (currently documented as exact-match only) and whether that's the intended behavior.
- E10.2 Call `POST /skills/extract-full-config-from-file` — the API map flags this as a likely response-validation bug (declared response model doesn't include `skills`/`metadata` fields the handler returns). Confirm whether this 500s, silently drops fields, or works despite the mismatch.
- E10.3 Extract skills from a JD with zero recognizable skills — verify an empty-but-valid response, not an error.

---

## 11. Analytics / Diversity dashboards (`/analytics`, `/diversity`)

AC:
- AC11.1 With zero evaluations for the selected role/period, the page shows the documented empty banner and does not crash rendering charts on all-zero data.
- AC11.2 Score distribution, skill-match rates, and diversity breakdowns mathematically match a manual count against `/results` for the same filter (spot-check, not just "a chart renders").
- AC11.3 Drilling down from a Score Distribution bar to the Leaderboard passes the correct `scoreMin`/`scoreMax` and the Leaderboard actually filters to that range.

Edge cases:
- E11.1 Switch the globally-selected job role while on `/analytics` — verify the page reloads data for the new role rather than showing stale numbers under a new label.
- E11.2 A role with candidates in only one experience level — Diversity's radar chart/data table is documented to only render with ≥3 levels; verify the "fewer than 3" case has a sensible fallback, not a broken partial chart.
- E11.3 Calibration view for a role with zero recorded Outcomes — verify `suggested_threshold` and related fields degrade gracefully (null/omitted) rather than dividing by zero.

---

## 12. Sharing & external review (`/share`, `/share/:token`, ShareView)

AC:
- AC12.1 A share link's `evaluation_ids`/`stages` filter is enforced both on initial view and on the vote endpoint (voting for an evaluation_id not in the linked set → 400).
- AC12.2 Expired links (`expires_at` in the past) return 410 on both view and vote; deactivated links (`is_active=false`) return 404-equivalent, and the UI's "Link not found or expired" copy covers both without distinguishing (confirm that's acceptable, not confusing for legitimate recipients).
- AC12.3 Voting is idempotent per `voter_token`+`evaluation_id` (upsert, not accumulating duplicate votes) and `vote:"clear"` actually removes a prior vote.

Edge cases:
- E12.1 Two different browsers (two different `localStorage` voter tokens) vote oppositely on the same candidate — verify both counts show correctly and neither overwrites the other.
- E12.2 Create a share link scoped to `stages:["hired"]` for a role with zero hired candidates — verify the view renders an empty candidate list, not an error.
- E12.3 Deactivate a share link while someone has it open in another tab — their next vote attempt should fail cleanly (404/410), not appear to succeed client-side.

---

## 13. Candidate self-service portal (`/jobs`, `/candidate/login`, `/candidate/profile`, `/candidate/dashboard`)

AC:
- AC13.1 Public job board (`/public/jobs`) never exposes a paused/expired role as "Apply Now"-able; both manual pause and `closes_at` expiry are treated identically.
- AC13.2 Applying twice to the same role within 180 days is blocked (400) with a clear next-eligible date; withdrawing still counts toward that freeze per the documented behavior.
- AC13.3 PAN card field is validated against the regex `[A-Z]{5}[0-9]{4}[A-Z]` server-side (422 on malformed) regardless of what the OCR/manual-entry UI pre-validates.
- AC13.4 `DELETE /candidate/account` anonymizes PII, soft-deletes the candidate, and deactivates the linked User such that no further login is possible — verify all three actually happen together, not just one.
- AC13.5 Google-login auto-creates a `role=candidate` User + linked Candidate exactly once per Google account (`is_new_user` correctly reflects first vs. repeat login).

Edge cases:
- E13.1 Apply to a role, then have an admin pause the role's intake before the candidate's evaluation finishes — verify the already-submitted application isn't silently lost, and matches AC5.1's queued behavior.
- E13.2 Trigger `/candidate/apply/{role_id}` twice in rapid succession (double-click "Apply Now") before the 180-day freeze row would exist yet — verify no duplicate application/duplicate resume version is created.
- E13.3 Freeze-check API call fails/times out (network blip) — per the frontend inventory, LandingPage swallows this error and proceeds with apply anyway. Confirm whether this actually allows a bypass of the 180-day freeze in practice.
- E13.4 Upload a resume file at exactly the candidate-portal's un-enforced "10MB" limit (frontend shows the label but, per inventory, does not enforce it) — verify the backend's real limit (`MAX_UPLOAD_MB`=20MB) is what actually governs, and a 15MB file isn't wrongly blocked or wrongly allowed relative to the displayed copy.
- E13.5 A candidate with no linked `Candidate` row (edge case: User row exists but `user_id` FK link missing) hits `/candidate/profile` — expect 404 per API map, not a crash.

---

## 14. Email ingestion & templates (`/email-ingestion`, `/admin/email-templates/*`, IMAP/Graph)

AC:
- AC14.1 IMAP/Graph credentials are stored encrypted at rest and the settings GET response masks the password (`imap_password_set:bool`, never the plaintext).
- AC14.2 Switching `email-ingestion-method` to `disabled` stops future polling without needing a restart (per the UI's own warning copy: "stops on the next poll cycle" — verify that's literally true).
- AC14.3 Built-in email templates (`next_steps`, `rejection`, etc.) can be overridden and reset back to the hardcoded default independently per key.
- AC14.4 Template attachments respect the 10MB/5-per-template caps server-side, not just client-side.

Edge cases:
- E14.1 Trigger `/admin/trigger-imap-fetch` twice concurrently — verify the second call either no-ops cleanly or is rejected, not two competing fetch threads double-ingesting the same emails.
- E14.2 Stop a fetch mid-run (`/admin/stop-imap-fetch`) — verify `imap-fetch-status` flips to not-running promptly and doesn't get stuck `true` after the stop.
- E14.3 The `localStorage` fetch-active flags (`imapFetchActive`/`graphFetchActive`) survive a page reload while the real fetch already finished server-side — verify the UI reconciles against `GET .../fetch-status` rather than trusting the stale local flag indefinitely.
- E14.4 Delete a built-in template key (not just reset) — verify it correctly falls back to the hardcoded default on next fetch, matching "DELETE resets built-ins to default."

---

## 15. Misc: Search, Kanban, Compare, PdfSplitView

AC:
- AC15.1 Search (`/search`) full-text and candidate-field search return only non-soft-deleted candidates.
- AC15.2 Kanban drag-and-drop stage change persists to the same `stage` field used everywhere else (Leaderboard, CandidateDetail) — moving a card and then checking the Leaderboard shows the same stage.
- AC15.3 Compare requires exactly 2 valid evaluation IDs; PdfSplitView correctly maps skill/evidence excerpts to their source location in the rendered PDF.

Edge cases:
- E15.1 Drag a Kanban card, then immediately have the underlying stage-patch API call fail (e.g. candidate deleted concurrently) — verify the optimistic `localStages` reverts rather than showing a stage that was never actually saved.
- E15.2 Resume-text search for a 1-character query — verify the documented 2-char minimum is enforced server-side, not just via a disabled search button.
- E15.3 Compare two evaluations from roles with completely disjoint skill sets — verify the Shared/Only-A/Only-B skill columns don't crash on an empty intersection.
- E15.4 Open PdfSplitView for a resume that failed OCR/parsing (no extractable text) — verify the "Failed to render PDF" fallback path, not a blank modal.

---

## Out of scope for this pass (flagged, not tested)

- `Landing.tsx` — dead code, unreachable via any route; excluded.
- OneDrive/SharePoint sync, LDAP/Azure AD directory sync, Google OAuth login, live GitHub/LinkedIn enrichment against real external accounts — require live third-party credentials not available in this sanitized local environment. Config-save/validation paths (AC14-style) are tested; live sync execution is not.
- Actual outbound email delivery (SMTP not configured in this environment) — send-triggering logic is tested for correct gating/side effects on the DB, not actual email receipt.
