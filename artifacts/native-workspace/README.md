# Foundation 0.6 native workspace reference

This reference uses the actual native extension renderer and its workspace/artifact models with a static browser fixture host. It is not the installed Code OSS application.

The Orbit canvas is compiled by the production `buildDesignPreview` function from saved bundled Orbit files. Source snapshots and analysis come from the production project service. React renders inside the same opaque, network-disabled sandbox used by Foundation. Source mapping is explicit instrumentation, not inferred. Selecting a mapped element connects its saved fixture source, inspector measurements, and AI context affordances.

## Try it

- Select **Save changes** with Inspect enabled. Move between Refine, Understand, Review, and Assistant; selection remains connected.
- Resize the inspector with the separator or its arrow-key controls. Test a narrow browser window and the Inspector button.
- Use the canvas viewport and theme controls independently from the workbench theme.
- Experiment with design tokens. These change the canvas only. Source proposals and Apply/Undo are explicitly unavailable here.
- Use the top source selector to simulate native source focus. Source links open a read-only snapshot dialog; there is no editable code surface in this fixture.
- Press **Source changed** for a fixture-only saved revision change. The previous preview remains stale until Rebuild preview loads the prepared current snapshot. Reset restores the original sample.

## Boundaries

- No provider, credentials, filesystem, editor buffer, workspace trust setting, or native app is connected.
- AI remains disconnected. No source is sent to a model; no artificial AI response is generated.
- The only network loads are same-origin static fixture/media/font assets. The product sandbox prohibits network requests, nested frames, form submission, and external images.
- The **compilation** result records production transpilation at fixture generation, not a browser-triggered build, full project typecheck, interaction verification, or visual acceptance. Rebuild preview loads the precompiled sample variant. Actual rendering/measurement happens in the browser.
- All host selection, source-changed variants, and layout state exist only in page memory. Reset/reload discards them. The changed variant adds a comment to an in-memory copy; generation never writes Orbit source.
- Fonts retain bundled Geist OFL notices; the compiled React runtime retains its MIT notices. Renderer copies should remain byte-identical to the production assets.

## Regenerate

From the Foundation root after bundling the extension runtime:

```sh
node artifacts/native-workspace/build-fixture.mjs
```

An explicit repository root may be supplied as the first argument. The generator reads source and writes only this artifact directory. It replaces absolute project roots with a fixture label and uses relative paths. Serve with a static HTTP server; direct `file:` URLs are unsupported because the renderer validates message origins.

`frame.html` uses a real same-origin URL with a fixture-only `acquireVsCodeApi` bridge. Native host and opaque product-frame messages remain distinct. Host actions are accepted only from the known renderer frame and same origin. Measurement events never move source focus; only an explicit selection does.

This fixture supports visual and interaction review. It does not establish native integration, provider quality, source-apply safety, or installed-package verification.
