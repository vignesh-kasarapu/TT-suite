# infra

No business logic. Azure deployment script (`deploy.ps1`, dormant until stage 11 —
D-083) and the workflow files this folder's docs point at. **The workflow files
themselves live at the repo root** (`.github/workflows/`, `.github/dependabot.yml`) per
D-092, not here — GitHub only reads root-level workflows, so authoring them anywhere
else means a move step at stage 11.
