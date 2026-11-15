# T13 clinical worker (Android): handoff

Branch `v11-and-clinical`. Files: `ui/clinical/**`, `ui/labs/**`, `res/values*/strings_clinical.xml` (all string names start `cn_`, generated from the iOS xcstrings by a script; hi and mr included).

## Done
- Chat (Clinical/Chat*.swift): list (Everyone first, unread, 60 s poll), thread (bubbles, notice style, pinned banner, composer with Post as notice, photo send via camera/gallery with caption, thumbnails, open file via link, full-screen image, retry, 4 s poll). Code: `ChatListScreen`, `ChatThreadScreen`, `ChatBubbles`, `ChatComposer`, `ChatImages`, `ClinicalFormat` (+ JVM test).
- Openers: `openChats()`, `openChat(id, title)`.

## Left (in this order)
- Labs (LabsScreen, LabCaseSheet, LabsV11Views, NewLabCaseScreen) -> `ui/labs/`, `openLabs()`.
- Team list (TeamScreens.swift), `openTeam()`.
- Analytics, Expenses (+ ExpenseSheet), `openAnalytics()`, `openExpenses()`.

## Needs from others
- Shell: More tiles call the openers above. Chat/labs/team routes live in `ClinicalRoutes.kt`.

## Commits
See `git log`.
