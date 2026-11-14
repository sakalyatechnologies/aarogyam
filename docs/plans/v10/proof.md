# G4: finish a task with a proof photo (mobile)

Branch `v10-proof`. My tasks rows (open, not pending) get a camera button next to Done.

- Shared: `ClinicApi.uploadTaskProof` (multipart, fixed name `proof.jpg`) in `tasks/TaskCalls.kt`;
  `MyTasksHolder.completeWithProof(id, note, usage, proof)` (SKIE has no default args, so a separate method);
  `proofSupported = true`. Upload first, then `CompleteBody.proofFileId`. The uploaded id is kept per
  occurrence (`proofIds`), so a retry after a failed complete does not upload twice. An upload failure
  puts the error on the row and sends no complete. `TaskAction`/`UsageLine` moved to `tasks/TaskTypes.kt` (file length).
  `ProofUploaded` added to `apiModels` in `shared/build.gradle.kts`.
- iOS: `Screens/TasksV10/TaskProofButton.swift` (camera, or the photo library when there is no camera;
  `PhotoPrep.jpeg`). After the photo: plain task completes directly, usage task opens the usage sheet, confirm-photos completes.
  The picked photo is kept per row id until the row leaves, so Retry sends it again.
- Strings (en, hi, mr): `tasks10.proof`, `tasks10.proof.library`.
- Tests: 4 new in `MyTasksHolderTest` (upload then complete with id; upload failure no complete; retry reuses one upload; no proof no upload),
  1 new in `TasksV10Tests`.

Gaps: no logging of `tasks.proof_failed` (the holder has no logger; nothing is logged at all). The camera
path is not exercised on the simulator (no camera); the library path is. No thumbnail of the chosen photo on the row.
