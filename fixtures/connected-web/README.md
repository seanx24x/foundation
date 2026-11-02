# Connected web verification fixture

A separate copy of saved Orbit UI source for Foundation's connected React/Vite adapter. The original `projects/orbit` and unsaved native drafts are not used or changed.

From the repository root, installed dependencies are shared by ordinary Node module resolution. Open this fixture in Foundation and choose Running app → Start, or run `npm run dev` here and connect its local URL. The Vite configuration explicitly includes Foundation's development plugin.

With Inspect on, select the Save button to inspect its mapped source. With Inspect off, use Request scenario to exercise success, a slow response, HTTP 503, or a dropped connection. Requests go to the fixture's local Vite middleware; submitted values are discarded. The existing failure checkbox also produces HTTP 503.

These are deliberate, reproducible fixture scenarios. They are not evidence about an external backend or an AI provider.
