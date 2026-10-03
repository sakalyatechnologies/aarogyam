<!-- Copied from sakalya-platform. Edit it there, then run scripts/sync-guidelines.sh. -->

# Git workflow

- `main` is always releasable. Work on short-lived branches: `feat/telemetry-gcp-format`, `fix/jwks-refresh`.
- Commits are small and do one thing. Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(http): add request id layer`, `fix(auth): reject expired tokens`, `docs: ...`, `chore: ...`.
- A commit that adds a dependency says why in its body.
- Every pull request passes CI and updates docs when behaviour changes.
- Version tags (`v0.3.0`) mark releases that product repositories depend on. Breaking changes bump the minor version while below 1.0.
