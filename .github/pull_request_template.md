<!--
Short on purpose: a person should understand the change from the title and this body in under a minute.
Title and body in English, Conventional Commits in the title: `[BEZ-<n>] type(scope): effect for the user`.
Base branch is `staging`; merge by rebase (default) or squash. Delete every comment and every section that does not apply.

IMAGES (check "PR body" fails without them when a screen or the design engine changes):
- Visual change: ONE image, before and after side by side:  pr-visual compare before.png after.png
  New screen (no "before"): one sheet:  pr-visual sheet a.png b.png ...
  Desktop and mobile each get their own image. Light and dark when the theme changes. Fake data only (the repo is public).
- Upload:  scripts/pr-assets.sh <folder> <png>...  and paste the markdown it prints, untouched (the ?raw=true matters).

DIAGRAM (logic, data or flow change): draw it right here in Mermaid (GitHub renders it), never as an image. Small, up to ~10 nodes:
  input, what happens, output, what happens on failure.
  sequenceDiagram: steps between systems or people | flowchart TD: decision rules | stateDiagram-v2: states of a record
  erDiagram: touched tables only | routes: table Route, Permission, Request, Responses | config: table Variable, Where it is set, Default
  No diagram clarifies? A Before | After table is enough.
-->
ClickUp: [card name](https://app.clickup.com/t/<id>)

<One or two sentences: what changes, for whom, and why. Link the SPEC or ADR if there is one.>

![](<screen change: ONE image, before | after>)

```mermaid
<logic, data or flow change: the diagram, here>
```

**Verified:** <what was actually exercised: tests, a real browser, a real database>
**Not verified:** <what was not, said plainly>
**Rollback:** <revert, flag, or "migration is additive">; delete if trivial
