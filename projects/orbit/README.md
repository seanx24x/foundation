# Orbit

A small product settings app for exploring Foundation's project workspace.

The files in this folder are real source files. Open a component, follow its imports,
make an edit, save, and inspect the change in Review. The Refine preview uses these
same files through Foundation's development server and updates when they change.

`App.tsx` composes the settings shell and `ProfileForm`. The form owns input and
submission state; `SaveButton` renders feedback; `api/profile.ts` sends the request.
Shared appearance lives in `styles/tokens.css`. The endpoint is the local fixture
service supplied by Foundation, not a production account service.

Preview element mapping is explicitly instrumented with `data-foundation-source`.
It is available for this included sample only. Inspect mode selects the mapped
element's source; leave inspect mode to use the app normally.

The Foundation server never runs this folder's scripts. To run Orbit separately,
install its dependencies and configure a proxy for `/api/orbit/profile` to Foundation's
local runtime on port 4174.
