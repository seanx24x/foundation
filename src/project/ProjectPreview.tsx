import { useEffect, useRef, useState } from "react";
import {
  Monitor,
  Smartphone,
  MousePointer2,
  RotateCw,
  ExternalLink,
} from "lucide-react";
import "./preview.css";

const mappedPaths = new Set([
  "src/App.tsx",
  "src/components/ProfileForm.tsx",
  "src/components/SaveButton.tsx",
]);

export default function ProjectPreview({
  onOpenSource,
  theme,
}: {
  onOpenSource: (path: string, line?: number) => void;
  theme: "dark" | "light";
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const [inspect, setInspect] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setState((current) => (current === "loading" ? "error" : current)),
      8000,
    );
    return () => window.clearTimeout(timeout);
  }, [generation]);
  const sendSettings = () =>
    frame.current?.contentWindow?.postMessage(
      { channel: "foundation-preview", inspect, theme },
      window.location.origin,
    );
  useEffect(() => {
    sendSettings();
  }, [inspect, theme]);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== "foundation-preview"
      )
        return;
      if (event.data.type === "select" && mappedPaths.has(event.data.path))
        onOpenSource(event.data.path, 1);
      if (event.data.type === "ready") {
        setState("ready");
        sendSettings();
      }
      if (event.data.type === "updated")
        setState((current) => (current === "error" ? "error" : "ready"));
      if (event.data.type === "error") setState("error");
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onOpenSource, inspect, theme]);
  return (
    <section className="project-preview" aria-label="Live Orbit preview">
      <div className="project-preview-toolbar">
        <span className={`preview-state ${state}`}>
          <i />
          {state === "ready"
            ? "Live preview"
            : state === "loading"
              ? "Connecting preview"
              : "Preview needs attention"}
        </span>
        <div className="project-preview-controls">
          <button
            aria-label="Desktop preview"
            aria-pressed={width === "desktop"}
            onClick={() => setWidth("desktop")}
          >
            <Monitor size={14} />
          </button>
          <button
            aria-label="Mobile preview"
            aria-pressed={width === "mobile"}
            onClick={() => setWidth("mobile")}
          >
            <Smartphone size={14} />
          </button>
          <span />
          <button
            aria-label="Inspect preview elements"
            aria-pressed={inspect}
            onClick={() => setInspect((value) => !value)}
          >
            <MousePointer2 size={14} />
            <span>Inspect</span>
          </button>
          <button
            aria-label="Reload preview"
            onClick={() => {
              setState("loading");
              setGeneration((v) => v + 1);
            }}
          >
            <RotateCw size={14} />
          </button>
          <a
            href="/project-preview.html"
            target="_blank"
            rel="noreferrer"
            aria-label="Open Orbit preview in a new tab"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
      {state === "error" && (
        <div className="project-preview-error" role="alert">
          The preview could not rebuild or render. Correct the source in Build,
          then reload the preview.
        </div>
      )}
      {inspect && (
        <p className="project-preview-hint">
          Select an element to open its instrumented component source.
        </p>
      )}
      <div className={`project-preview-canvas ${width}`}>
        <iframe
          ref={frame}
          key={generation}
          title="Orbit live application"
          src="/project-preview.html"
          onLoad={sendSettings}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
      <div className="project-preview-note">
        Included sample · saved source updates live · explicit component mapping
      </div>
    </section>
  );
}
