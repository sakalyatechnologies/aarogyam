# v8.1 concepts: handoff

File: `docs/mockups/mobile-v81-concepts.html` (v8 plus five concepts on the iPhone only; Android is unchanged). Chips C1 to C5 at the top jump to each demo. Light and dark work; `prefers-reduced-motion` removes ripples, tilt and flip (flat arch, crossfade). Targets are 44 px or more. Sample data only.

## What each concept shows and what it implies natively

| | Shows | Native work |
|---|---|---|
| C1 | Live chair timer on the island (Chair 2 · Token 14 · mm:ss), frosted floating dock with a spring capsule, Day 0 connect card, Day 1+ briefing (patients, first appointment, dues, lab cases) | ActivityKit Live Activity plus Dynamic Island layouts (compact, expanded, lock screen); SwiftUI dock with matched-geometry capsule; briefing endpoint (counts only) |
| C2 | 3D arch tilting on drag, tap tooth then M/D/O/B/L, instant diagnosis sheet, corner thumb arc with four actions, button for every gesture | SceneKit or RealityKit arch (or SwiftUI 3D transforms), hit targets, drag-to-select arc gesture, diagnosis suggestion source |
| C3 | Bento tiles for chairs, collections waterfall, lab timeline that grow into sheets; rubber-band carousel | SwiftUI matchedTransitionSource and zoom navigation transition; Swift Charts waterfall; spring-based carousel |
| C4 | Emerald voice pill with ripples, live transcript, tooth/diagnosis/drug chips with tick and cross, en/hi/mr | Speech framework (on-device where available) or cloud STT; an entity extractor (FDI, diagnoses, drug and strength); strict rule that nothing is written until tick |
| C5 | 3D flip between Doctor layout and Front desk layout with UPI QR collect, photo, consent, intake | Layout switch driven by server-granted roles; UPI intent or QR generation; camera capture; keep the money views server-gated |

## Rules baked in

- No patient name and no vitals on the island or lock screen. Only chair, token, time.
- Voice never writes by itself. Counters stay at 0 until the doctor taps the tick. Amoxicillin on a penicillin-allergic patient raises a warning.
- The role flip is shown only to members who hold both roles, and changes layout only. Permissions still come from the server.

## Open questions for the founder

1. Island: should the timer also appear when the app is backgrounded for the whole visit, and who may start or end it (doctor only, or assistant too)?
2. Is token number the right lock-screen identifier, or should the chair alone be shown for clinics without tokens?
3. Arch: teeth in a 3D arch are under 44 pt. Is the stepper plus surface buttons enough for gloves, or should the arch become two 8-tooth halves?
4. Should the thumb arc be left-handed switchable, and are Dictate, Chart, Rx, Close the right four?
5. Diagnosis sheet: where do suggestions come from (rules on the surface, past visits, or a model), and who is accountable for them?
6. Voice: store audio, or transcript only? Is on-device STT acceptable for Hindi and Marathi quality?
7. Voice allergy check: block, or warn, when a suggested drug conflicts with a recorded allergy?
8. Doctor/Desk flip: is a two-role member common enough to justify a flip, or should Desk be a tab?
9. Day 0: scan a clinic QR, or accept an invite link only (v8 already has invites)?
10. Dues on the briefing: hide for assistants (done here) and for doctors who do not hold finance?
