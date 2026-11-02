import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "../../projects/orbit/src/App";

function tellParent(message: object) {
  if (window.parent !== window)
    window.parent.postMessage(
      { channel: "foundation-preview", ...message },
      window.location.origin,
    );
}

class PreviewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    tellParent({ type: "error" });
  }
  render() {
    return this.state.failed ? (
      <div style={{ padding: 32 }}>
        The preview could not render. Fix the source, then reload the preview.
      </div>
    ) : (
      this.props.children
    );
  }
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window.parent ||
    event.origin !== window.location.origin ||
    event.data?.channel !== "foundation-preview"
  )
    return;
  document.documentElement.dataset.foundationInspect = event.data.inspect
    ? "true"
    : "false";
  document.documentElement.dataset.theme =
    event.data.theme === "dark" ? "dark" : "light";
});
document.addEventListener(
  "click",
  (event) => {
    if (
      document.documentElement.dataset.foundationInspect !== "true" ||
      !(event.target instanceof Element)
    )
      return;
    const element = event.target.closest<HTMLElement>(
      "[data-foundation-source]",
    );
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    tellParent({ type: "select", path: element.dataset.foundationSource });
  },
  true,
);
if (import.meta.hot) {
  import.meta.hot.on("vite:error", () => tellParent({ type: "error" }));
  import.meta.hot.on("vite:afterUpdate", () => tellParent({ type: "updated" }));
}
createRoot(document.getElementById("root")!).render(
  <PreviewBoundary>
    <App />
  </PreviewBoundary>,
);
tellParent({ type: "ready" });
