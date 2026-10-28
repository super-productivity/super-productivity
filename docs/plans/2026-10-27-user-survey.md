# User survey: learn from users without telemetry

## Objective

Answer four open product questions with data from users, without adding
analytics. The [README](../../README.md) promises the app "does NOT collect
any data" and the product principles in `AGENTS.md` rule out telemetry, so the
survey runs outside the app and is answered only by people who choose to.

Questions the survey must help decide:

1. **Onboarding** (`2026-10-27-onboarding-next-steps.md`): what makes the first
   week hard, and on which platform.
2. **Sync priorities**: which providers the sync work actually serves, and what
   stops sync working.
3. **Scope**: which features users rely on, and whether AI capture and the
   Plainspace bridge reach real users.
4. **What next**: which direction users would put first.

Every question below names the decision it can change. A question that cannot
change one is cut.

## Decision: a one-off survey, not telemetry

Opt-in telemetry was rejected: it breaks the published promise and the product
principles, and needs a consent UI and a backend. A survey costs no code,
answers "why" questions and ends on a set date. It shares telemetry's
self-selection bias; see [Reading the results](#reading-the-results).

## Tool

**CryptPad Forms** (cryptpad.fr): open source, end-to-end encrypted, no account
needed to respond. Its [documentation](https://docs.cryptpad.org/en/user_guide/apps/form.html)
confirms anonymized responses, a maximum number of checkbox selections, CSV
export and a closing date (checked 2026-10-27). Step 1 confirms them on the
real form.

Settings: guest access allowed, responses anonymized, every question optional,
closing date set 4 weeks after launch. **Never enable "Publish Responses"**: it
makes every raw answer visible to participants and cannot be undone.

## Privacy

- No name, email or account field. Anyone open to a follow-up replies in the
  GitHub Discussion instead.
- Intro text: "About 3–4 minutes. Not connected to the app; no name or email
  asked. The maintainer reads the answers privately and publishes a summary at
  <link> by <date>. Raw answers are deleted 30 days after that. The form is
  hosted by CryptPad: <privacy policy link>." Do not promise "no tracking": the
  host still sees IP addresses.
- Above each free-text field: "Please don't include names, employers or task
  contents."
- Only the maintainer opens raw responses and the CSV export, kept locally,
  never committed. Both the form's responses and every export are deleted 30
  days after the summary is published.
- Published results contain counts, themes and short paraphrases, never raw
  answers.

## Questions

Intro as above. All optional. Options are listed in the order shown.

**Q1. Which platforms do you use Super Productivity on?** Checkbox: Windows ·
macOS · Linux · Android · iOS · Web browser · Other.
_Changes:_ how much onboarding work targets phones. Groups overlap; report
them as overlapping.

**Q2. How long have you used it?** Radio: less than a week · 1 week to 1 month
· 1–12 months · 1–3 years · more than 3 years · I stopped using it.
_Changes:_ nothing alone; separates answers from new users (who saw the
onboarding shipped in v19.3.0, 2026-10-23) from long-time and former users.

**Q3. How do you mainly sync?** Radio: no sync · SuperSync · Nextcloud · other
WebDAV · Dropbox · OneDrive · local file (e.g. with Syncthing) · not sure.
**Q3b. What, if anything, stops sync working well for you?** Free text.
_Changes:_ which providers get testing and fixes first. Popularity alone does
not decide a provider's reliability work or retirement.

**Q4. During your first week, what, if anything, was hard or confusing? On
which platform?** Free text; "nothing" and "don't remember" are fine answers.
_Changes:_ step 2 of the onboarding plan: a recurring first-week obstacle from
users with Q2 under a month becomes a candidate fix.

**Q5. Which features would you miss most? Pick up to 3.** Checkbox, max 3:
Today view · Inbox · Planner · Schedule · Boards · Projects · Tags · Subtasks
· Notes · Time estimates · Time tracking · Focus mode / Pomodoro · Break
reminders · Idle time detection · Reminders · Repeating tasks · Worklog ·
Reflection / metrics · Archive and history · Issue integrations (Jira, GitHub,
…) · Calendar integration · Plugins · Short syntax · Keyboard shortcuts ·
Backup and import. No "Other": CryptPad allows at most 25 options per
question, and Q6 and Q9 already take free text.
_Changes:_ which features new-user defaults and the quick tour should show.
It measures relative importance among the listed features; a low count makes a
feature a candidate to investigate, never to remove without the usual review.

**Q6. Was there something you wanted to do but couldn't find or understand?**
Free text.
_Changes:_ onboarding hints and docs for anything named by several users.

**Q7. For tasks shared with other people, which tool do you use?** Radio: I
don't share tasks · Plainspace · another tool (free text).
_Changes:_ whether the Plainspace bridge work continues at its planned scope.

**Q8. Have you connected Super Productivity to an AI assistant?** Radio: yes,
I use it · tried it and stopped · I know it's possible but haven't · didn't
know it was possible · I don't want AI in my task app.
_Changes:_ how much further the AI capture connector goes; "don't want it"
counts weigh against built-in AI (scorecard row 21, open decision).

**Q9. What one thing most gets in the way of using Super Productivity?** Free
text.
_Changes:_ leads for issues, not roadmap votes.

**Q10. What should we focus on next? Pick up to 2.** Checkbox, max 2: App
stability and speed · Sync reliability · Mobile apps · Faster task capture
(including sharing from other apps) · Reminders · Planning and time tracking ·
Developer integrations (Jira, GitHub, GitLab, …) · Connect to AI assistants ·
Nothing, it's fine as it is.
_Changes:_ the order of the next roadmap items. The options follow the
scorecard rows (both "must not lose" gaps and "must be best" strengths) and
leave out what the project won't build (team collaboration). The cap forces a
trade-off. A direction that comes out on top still needs demand in issues and
the review in `docs/feature-review-guide.md` before work starts.

If the pilot runs over 4 minutes, cut Q7 first, then Q3b. Keep Q8: it is the
only place "I don't want AI" can be recorded.

## Steps

1. **Build the form** in CryptPad from the questions above.
   → verify on the participant link while logged out: a 4th tick in Q5 and a
   3rd in Q10 are blocked; a skipped answer shows as empty in the CSV export;
   multi-line free text survives the export; responses are not visible to
   participants; the closing date is set.
2. **Pilot** with 3 people: one who started on a phone within the last month,
   one occasional user, one active Discussion participant.
   → verify: each finishes within 4 minutes; note any question someone pauses
   on or misreads and reword it; delete the pilot responses.
3. **Launch**: pinned GitHub Discussion (why, what happens with the answers,
   close date), one line in the next release notes (reaches Play, Snap and
   Flathub users), existing social channels. No in-app notice.
   → verify: each channel links the same form.
4. **Reminder** after 1 week: repost once in the same channels.
   → verify: reposted; no in-app prompt added.
5. **Analyse** after the form closes: export CSV; per question, report answered
   and skipped counts; write the free-text theme list after reading the first
   30 answers, then count respondents per theme; split Q4, Q5 and Q10 by Q2 and
   Q1; report no split with fewer than 20 answers.
   → verify: every finding names its question and its count.
6. **Publish** `docs/research/2026-11-user-survey-results.md` with the snapshot
   date and response count, as "observation → proposed action → what to verify
   next"; link it from the Discussion. Update the onboarding plan's hypotheses;
   change scorecard ratings only after checking the app's behavior. Delete raw
   responses and exports 30 days later.
   → verify: each of the four objective questions has an answer or an explicit
   "inconclusive" (under 20 answers, or no theme named by 3 or more people).

## Reading the results

- Respondents are self-selected volunteers and skew to engaged users who read
  GitHub or release notes; people who gave up early are mostly missing. Report
  counts, not shares of "the user base".
- Guests can submit more than once, so counts are responses, not unique
  people. Remove obvious spam (empty or duplicate submissions) and say how
  many.
- Free-text stories explain why something happens; they are not prevalence.
  Keep contradicting answers in the summary.

## Out of scope

- Any in-app collection, prompt or link that sends data.
- Recurring surveys; decide after this one whether a second is worth it.
- Satisfaction scores or NPS: they would not change a decision.

## Risks

- **Low or skewed turnout** → counts reported honestly; findings stay
  "inconclusive" rather than stretched.
- **Seen as a step toward tracking** → intro and Discussion state that it is
  one-off, anonymous and outside the app.
- **Personal data in free text** → warning above each field, maintainer-only
  access, deletion deadline, only paraphrases published.
