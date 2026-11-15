# T13 clinical worker (Android): handoff

Branch `v11-and-clinical`. Files: `ui/clinical/**`, `ui/labs/**`, `res/values*/strings_clinical.xml` (all string names start `cn_`, generated from the iOS xcstrings by a script; hi and mr included).

## Done
- Chat (Clinical/Chat*.swift): list (Everyone first, unread, 60 s poll), thread (bubbles, notice style, pinned banner, composer with Post as notice, photo send via camera/gallery with caption, thumbnails, open file via link, full-screen image, retry, 4 s poll). Code: `ChatListScreen`, `ChatThreadScreen`, `ChatBubbles`, `ChatComposer`, `ChatImages`, `ClinicalFormat` (+ JVM test).
- Openers: `openChats()`, `openChat(id, title)`.

- Labs (`ui/labs/`): directory with vendor line, cases with tracker pill, case sheet (tracker, contact log, Remind, Mark received), new case (patient picker + form), Remind all with Email/WhatsApp and result card. `openLabs()`.
- Team list (`ui/clinical/TeamScreen.kt`), `openTeam()`.

## Left
- Expenses (+ ExpenseSheet), `openExpenses()`.
- Analytics: DEFERRED by coordinator. Another worker is rebuilding iOS Analytics (custom dates, revenue vs expenses, expense categories, per-chair use, real data) with new shared holder logic; port that version once it lands. `openAnalytics()` still to add (stub it to ComingSoon meanwhile).
- Messages/Inbox page (iOS InboxPage) not in the opener list; not ported.

## Notes
- The scratchpad is shared between workers: keep own scripts in a subdirectory.

## Needs from others
- Shell: More tiles call the openers above. Chat/labs/team routes live in `ClinicalRoutes.kt`.

## Commits
See `git log`.
