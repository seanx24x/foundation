# Reproducible profile fixture

A development-only React/Vite example for Foundation scenario replay. It registers five explicit app-authored recipes: idle, held loading, successful save, HTTP error, and network failure. Each recipe resets the visible profile and fixture choice first. Success/error/offline exercise the real local fixture endpoint; idle and held loading are intentionally authored UI states. Nothing is sent outside this local development target and no account is created.

The recipe receives an AbortSignal and requested application theme/motion conditions. Theme is implemented with a data attribute; this fixture has no animated transition. Browser media preferences remain separate evidence. Actions call the same save function as the button, rather than claiming trusted human input. Callback completion is execution evidence, not visual acceptance or a Foundation assertion about backend behavior.

Run `npm run dev` in this directory with the repository dependencies available. Open the folder in Foundation, create a feature containing `src/App.tsx`, add a screen at `/` and a manual scenario, and begin its observation. Choose a recipe in the inspector, then **Replay recipe**. Inspect or capture the result, give your own assessment, and finish. Begin a new observation to replay again. Source changes or uncertain interruption require reopening the screen.
