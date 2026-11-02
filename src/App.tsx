import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Command,
  Component,
  FileCode2,
  Folder,
  GitBranch,
  Globe2,
  Layers2,
  Link2,
  Loader2,
  Maximize2,
  Monitor,
  Moon,
  MoreHorizontal,
  MousePointer2,
  PanelBottom,
  PanelLeftClose,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Terminal,
  Waypoints,
  X,
} from "lucide-react";
import { SaveButton } from "../fixtures/web/src/SaveButton";
import FixtureBoundary from "./components/FixtureBoundary";
import type {
  RequestEvidence as Evidence,
  VerificationRun as Verification,
  WorkspaceSnapshot as Workspace,
} from "./domain/contracts";

const SourceEditor = lazy(() => import("./components/SourceEditor"));
const ProjectWorkbench = lazy(() => import("./project/ProjectWorkbench"));
const DiffViewer = lazy(() => import("./components/DiffViewer"));

type Mode = "Understand" | "Build" | "Refine" | "Review";
type Target = "web" | "swiftui" | "expo";
const modes: { name: Mode; icon: typeof Waypoints; key: string }[] = [
  { name: "Understand", icon: Waypoints, key: "1" },
  { name: "Build", icon: Code2, key: "2" },
  { name: "Refine", icon: MousePointer2, key: "3" },
  { name: "Review", icon: CheckCheck, key: "4" },
];
const targetLabels = {
  web: "Web · React",
  swiftui: "iOS · SwiftUI",
  expo: "iOS · Expo",
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Provenance({
  kind = "source",
}: {
  kind?: "source" | "observed" | "ai" | "unknown";
}) {
  return (
    <span className={`provenance ${kind}`}>
      <span />
      {
        {
          source: "From source",
          observed: "Observed",
          ai: "AI interpretation",
          unknown: "Unknown",
        }[kind]
      }
    </span>
  );
}
function Logo() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path fill="currentColor" d="M3 5h18v4H7v3h11v4H7v5H3z" />
      <path fill="currentColor" opacity=".42" d="M11 18h10v3H11z" />
    </svg>
  );
}

function Walkthrough({
  theme,
  onThemeChange,
  onOpenProject,
  active,
}: {
  theme: "dark" | "light";
  onThemeChange: () => void;
  onOpenProject: () => void;
  active: boolean;
}) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [mode, setMode] = useState<Mode>("Understand");
  const [target, setTarget] = useState<Target>("web");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [panel, setPanel] = useState<"details" | "assistant">("details");
  const [bottom, setBottom] = useState<
    "Trace" | "Network" | "Checks" | "Activity"
  >("Trace");
  const [selection, setSelection] = useState("component");
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewProblem, setPreviewProblem] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [name, setName] = useState("Alex Morgan");
  const [email, setEmail] = useState("alex@orbit.design");
  const [scenario, setScenario] = useState<"success" | "error">("success");
  const [requests, setRequests] = useState<Evidence[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );
  const [running, setRunning] = useState(false);
  const [radius, setRadius] = useState(7);
  const [padding, setPadding] = useState(17);
  const [experiment, setExperiment] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [showNavigator, setShowNavigator] = useState(true);
  const [showBottom, setShowBottom] = useState(true);
  const [focusPreview, setFocusPreview] = useState(false);
  const [navTab, setNavTab] = useState<"Product" | "Files">("Product");
  const [previewTab, setPreviewTab] = useState<"Profile" | "Preferences">(
    "Profile",
  );
  const [inspectorWidth, setInspectorWidth] = useState(304);
  const [navWidth, setNavWidth] = useState(210);
  const [activity, setActivity] = useState<string[]>([
    "Foundation web fixture ready.",
    "Select the Save button to follow its behavior.",
  ]);
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const saveRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const sourceRef = useRef("");
  const draftRevision = useRef("");
  const operationRef = useRef(false);

  const record = (message: string) =>
    setActivity((items) => [...items.slice(-30), message]);
  const receive = useCallback((data: Workspace) => {
    setWorkspace(data);
    setRequests(data.requests);
    if (!data.proposal || data.proposal.status === "applied") {
      setRadius(Number(data.source.match(/borderRadius:\s*(\d+)/)?.[1] ?? 7));
      setPadding(
        Number(data.source.match(/paddingInline:\s*(\d+)/)?.[1] ?? 17),
      );
    }
    if (!dirtyRef.current || data.source === sourceRef.current) {
      setSource(data.source);
      sourceRef.current = data.source;
      setDirty(false);
      dirtyRef.current = false;
      draftRevision.current = data.revision;
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      receive(await api<Workspace>("workspace"));
      setError(null);
    } catch {
      setError(
        "The local runtime is disconnected. Start npm run dev, then reconnect.",
      );
    }
  }, [receive]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty]);
  useEffect(() => {
    const hot = import.meta.hot;
    if (!hot) return;
    const failed = () =>
      setPreviewProblem(
        "The preview could not rebuild. The last rendered version may be outdated. Fix the source in Build to recover.",
      );
    const recovered = () => setPreviewProblem(null);
    hot.on("vite:error", failed);
    hot.on("vite:afterUpdate", recovered);
    return () => {
      hot.off("vite:error", failed);
      hot.off("vite:afterUpdate", recovered);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const open = active && (showPalette || showSetup);
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      queueMicrotask(() =>
        modalRef.current?.querySelector<HTMLElement>("input,button")?.focus(),
      );
    } else previousFocus.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === "Escape") {
        setShowPalette(false);
        setShowSetup(false);
      }
      if (event.key === "Tab") {
        const list = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,[tabindex="0"]',
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [active, showPalette, showSetup]);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowPalette((value) => !value);
        setQuery("");
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        ["1", "2", "3", "4"].includes(event.key)
      ) {
        event.preventDefault();
        setMode(modes[Number(event.key) - 1].name);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active]);

  const action = async (
    label: string,
    run: () => Promise<void>,
    allowDraft = false,
  ) => {
    if (operationRef.current) return;
    if (dirtyRef.current && !allowDraft) {
      setError(
        "Save or discard your unsaved source edits in Build before continuing. Your draft has been preserved.",
      );
      return;
    }
    operationRef.current = true;
    setBusy(label);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
    } finally {
      operationRef.current = false;
      setBusy(null);
    }
  };
  const propose = (kind: "behavior" | "visual" = "behavior") =>
    action("Preparing change", async () => {
      if (workspace?.mappingSupported === false)
        throw new Error(
          "This source is outside the scripted fixture mapping. Continue editing in Build; existing runtime observations remain available.",
        );
      const data = await api<Workspace>(
        "proposal",
        kind === "visual" ? { kind, radius, padding } : {},
      );
      receive(data);
      setMode("Review");
      setPanel("assistant");
      record("Prepared a scripted proposal. Source has not changed.");
    });
  const apply = () =>
    action("Applying change", async () => {
      if (!workspace?.proposal) return;
      receive(
        await api<Workspace>("apply", {
          baseRevision: workspace.proposal.baseRevision,
          proposalId: workspace.proposal.id,
        }),
      );
      setExperiment(false);
      record("Applied the reviewed change to SaveButton.tsx.");
      setToast("Source updated. The preview is refreshing.");
    });
  const undo = () =>
    action("Restoring source", async () => {
      receive(await api<Workspace>("undo", {}));
      setExperiment(false);
      record("Restored the source checkpoint.");
      setToast("Foundation’s change was undone.");
    });
  const verify = () =>
    action("Checking TypeScript", async () => {
      const result = await api<Verification>("verify", {});
      setWorkspace((old) => (old ? { ...old, verification: result } : old));
      setBottom("Checks");
      setShowBottom(true);
      record(
        `TypeScript ${result.checks[0]?.status}. Interaction and visual review remain separate.`,
      );
    });
  const saveSource = () =>
    action(
      "Saving source",
      async () => {
        if (!workspace) return;
        receive(
          await api<Workspace>("source", {
            source: sourceRef.current,
            baseRevision: draftRevision.current,
          }),
        );
        record("Saved a manual source edit. Previous evidence may be stale.");
        setToast("Source saved.");
      },
      true,
    );
  const saveProfile = async () => {
    setRunning(true);
    setSelection("request");
    setSelectedRequestId(null);
    try {
      await api("profile", {
        name,
        email,
        simulateError: scenario === "error",
      });
      record("Observed POST /api/profile → 200.");
      setToast("Profile saved in the local fixture.");
    } catch (e) {
      record("Observed POST /api/profile → error.");
      throw e;
    } finally {
      try {
        setRequests(await api<Evidence[]>("requests"));
      } catch {
        setError(
          "The request finished, but its evidence could not be refreshed. Reconnect to retrieve the recorded result.",
        );
      } finally {
        setRunning(false);
      }
    }
  };
  const runScenario = () => {
    setPreviewTab("Profile");
    setMode("Understand");
    setShowBottom(true);
    setBottom("Network");
    setTimeout(
      () =>
        saveRef.current?.querySelector<HTMLButtonElement>("button")?.click(),
      50,
    );
  };
  const latest =
    requests.find((request) => request.id === selectedRequestId) ?? requests[0];
  const sourceStale =
    latest && workspace && latest.revision !== workspace.revision;
  const verificationStale =
    workspace?.verification &&
    workspace.verification.revision !== workspace.revision;
  const resize = (
    side: "nav" | "inspector",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const start = event.clientX,
      initial = side === "nav" ? navWidth : inspectorWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const width = initial + (e.clientX - start) * (side === "nav" ? 1 : -1);
      (side === "nav" ? setNavWidth : setInspectorWidth)(
        Math.max(
          side === "nav" ? 170 : 270,
          Math.min(side === "nav" ? 300 : 440, width),
        ),
      );
    };
    const element = event.currentTarget;
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  };
  const commands = [
    ...modes.map((item) => ({
      title: `Go to ${item.name}`,
      hint: `⌘ ${item.key}`,
      action: () => setMode(item.name),
    })),
    {
      title: "Run the Save scenario",
      hint: "Local request",
      action: runScenario,
    },
    {
      title: "Review a loading and error state",
      hint: "Scripted proposal",
      action: () => void propose(),
    },
    {
      title: "Connect a project target",
      hint: "Setup",
      action: () => setShowSetup(true),
    },
    {
      title: `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
      hint: "Appearance",
      action: () => onThemeChange(),
    },
    {
      title: "Toggle navigator",
      hint: "Layout",
      action: () => setShowNavigator((value) => !value),
    },
  ];

  return (
    <div
      className="workbench"
      style={
        {
          "--nav-width": `${navWidth}px`,
          "--inspector-width": `${inspectorWidth}px`,
        } as CSSProperties
      }
    >
      <header className="titlebar">
        <div className="window-controls" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="brand">
          <Logo />
          <span>Foundation</span>
          <span className="prototype-tag">Preview</span>
        </div>
        <button className="project-title" onClick={() => setShowSetup(true)}>
          <span className="project-mark">O</span>Orbit
          <ChevronDown size={12} />
        </button>
        <button
          className="command-search"
          onClick={() => {
            setShowPalette(true);
            setQuery("");
          }}
        >
          <Search size={13} />
          <span>Find anything in your project</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="title-actions">
          <button className="mini-button" onClick={onOpenProject}>
            <Folder size={13} />
            Project workspace
          </button>
          <IconButton
            label="Toggle navigator"
            onClick={() => setShowNavigator((v) => !v)}
          >
            <PanelLeftClose size={16} />
          </IconButton>
          <IconButton
            label="Toggle evidence panel"
            onClick={() => setShowBottom((v) => !v)}
          >
            <PanelBottom size={16} />
          </IconButton>
          <IconButton
            label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => onThemeChange()}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
        </div>
      </header>

      <div className="workspace-toolbar">
        <button className="branch-button" onClick={() => setShowSetup(true)}>
          <GitBranch size={14} />
          <span>foundation / exploration</span>
          <ChevronDown size={11} />
        </button>
        <nav aria-label="Workspace activity" className="mode-switcher">
          {modes.map(({ name: label, icon: Icon, key }) => (
            <button
              key={label}
              onClick={() => setMode(label)}
              className={mode === label ? "selected" : ""}
              aria-current={mode === label ? "page" : undefined}
              title={`${label} · ⌘${key}`}
            >
              <Icon size={15} />
              {label}
              {label === "Review" && workspace?.proposal && (
                <span className="notification-dot" />
              )}
            </button>
          ))}
        </nav>
        <button className="target-button" onClick={() => setShowSetup(true)}>
          {target === "web" ? <Globe2 size={13} /> : <Smartphone size={13} />}
          <span>{targetLabels[target]}</span>
          <ChevronDown size={11} />
        </button>
      </div>

      <div
        className={`workspace-body ${!showNavigator ? "hide-nav" : ""} ${focusPreview ? "focus-preview" : ""}`}
      >
        {showNavigator && (
          <aside className="navigator">
            <div className="navigator-head">
              <div className="small-tabs">
                {(["Product", "Files"] as const).map((tab) => (
                  <button
                    key={tab}
                    className={navTab === tab ? "selected" : ""}
                    onClick={() => setNavTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <IconButton
                label="Project setup"
                onClick={() => setShowSetup(true)}
              >
                <Plus size={15} />
              </IconButton>
            </div>
            <button className="tree-project" onClick={() => setShowSetup(true)}>
              <span className="project-mark">O</span>
              <div>
                <strong>Orbit</strong>
                <span>Web fixture</span>
              </div>
              <ChevronDown size={12} />
            </button>
            {navTab === "Product" ? (
              <>
                <div className="nav-section-label">Workspace</div>
                <button
                  className={`tree-row ${selection === "overview" ? "active" : ""}`}
                  onClick={() => {
                    setSelection("overview");
                    setShowSetup(true);
                  }}
                >
                  <Layers2 size={15} />
                  Overview
                </button>
                <button
                  className="tree-row"
                  onClick={() => {
                    setMode("Understand");
                    setPreviewTab("Profile");
                  }}
                >
                  <ChevronDown size={12} />
                  <Monitor size={14} />
                  Settings
                </button>
                <button
                  className="tree-row nested"
                  onClick={() => {
                    setMode("Understand");
                    setPreviewTab("Profile");
                    setSelection("component");
                  }}
                >
                  <Component size={14} />
                  Profile
                </button>
                <button
                  className={`tree-row nested deep ${selection === "component" ? "active" : ""}`}
                  onClick={() => {
                    setSelection("component");
                    setPanel("details");
                  }}
                >
                  <MousePointer2 size={13} />
                  <span>SaveButton</span>
                  <span className="tree-selection-dot" />
                </button>
                <div className="nav-section-label">Connected context</div>
                <button
                  className={`tree-row ${selection === "request" ? "active" : ""}`}
                  onClick={() => {
                    setSelection("request");
                    setBottom("Network");
                    setShowBottom(true);
                  }}
                >
                  <Waypoints size={15} />
                  API requests
                  {requests.length > 0 && (
                    <span className="count">{requests.length}</span>
                  )}
                </button>
                <button
                  className="tree-row"
                  onClick={() => {
                    setMode("Refine");
                    setPanel("details");
                  }}
                >
                  <Component size={15} />
                  Design properties
                </button>
                <button
                  className="tree-row"
                  onClick={() => {
                    setBottom("Checks");
                    setShowBottom(true);
                  }}
                >
                  <ShieldCheck size={15} />
                  Verification
                </button>
              </>
            ) : (
              <>
                <div className="nav-section-label">foundation / fixtures</div>
                <div className="tree-row">
                  <ChevronDown size={12} />
                  <Folder size={14} />
                  web
                </div>
                <div className="tree-row nested">
                  <ChevronDown size={12} />
                  <Folder size={14} />
                  src
                </div>
                <button
                  className="tree-row nested deep active"
                  onClick={() => {
                    setMode("Build");
                    setSelection("component");
                  }}
                >
                  <FileCode2 size={14} />
                  SaveButton.tsx
                </button>
                <div className="nav-file-note">
                  This walkthrough edits one managed fixture. Full repository
                  browsing is specified in the blueprint.
                </div>
              </>
            )}
            <div className="navigator-bottom">
              <div className="local-status">
                <span
                  className={
                    workspace ? "status-light" : "status-light offline"
                  }
                />
                <span>
                  {workspace
                    ? "Local runtime connected"
                    : "Waiting for runtime"}
                </span>
              </div>
              <button onClick={() => setShowSetup(true)}>
                <Settings2 size={13} />
                Project & capabilities
                <ArrowUpRight size={12} />
              </button>
            </div>
            <div
              className="resize-handle nav-handle"
              role="separator"
              aria-label="Resize navigator"
              aria-orientation="vertical"
              tabIndex={0}
              onPointerDown={(event) => resize("nav", event)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight")
                  setNavWidth((v) => Math.min(300, v + 10));
                if (event.key === "ArrowLeft")
                  setNavWidth((v) => Math.max(170, v - 10));
              }}
            />
          </aside>
        )}

        <main className="main-workspace">
          <div className="context-bar">
            <div className="breadcrumb">
              <Component size={14} />
              <button onClick={() => setPreviewTab("Profile")}>Settings</button>
              <ChevronRight size={12} />
              <span>Profile</span>
              <ChevronRight size={12} />
              <strong>SaveButton</strong>
            </div>
            <span className="context-preserved">
              <Link2 size={12} />
              Shared context
            </span>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => void refresh()}>Reconnect</button>
              <IconButton label="Dismiss error" onClick={() => setError(null)}>
                <X size={13} />
              </IconButton>
            </div>
          )}
          {!workspace ? (
            <div className="loading-workspace">
              <Logo />
              <h2>Connect the pieces.</h2>
              <p>
                {error
                  ? "The local runtime needs to be started."
                  : "Opening your Foundation workspace…"}
              </p>
              <button
                className="secondary-button"
                onClick={() => void refresh()}
              >
                <RotateCcw size={14} />
                Reconnect
              </button>
            </div>
          ) : target !== "web" ? (
            <div className="capability-empty">
              <div className="native-icon">
                <Smartphone size={32} />
              </div>
              <span className="subtle-label">
                Platform integration blueprint
              </span>
              <h1>
                {target === "swiftui"
                  ? "SwiftUI, connected to the whole picture."
                  : "React Native, with the same shared context."}
              </h1>
              <p>
                {target === "swiftui"
                  ? "Source intelligence, Xcode builds, preview captures, and Simulator verification."
                  : "Component inspection, runtime requests, source edits, and device verification."}{" "}
                This adapter is specified and is not connected in this web
                prototype.
              </p>
              <div className="capability-list">
                {(target === "swiftui"
                  ? [
                      "SourceKit-LSP language intelligence",
                      "Xcode preview capture through MCP",
                      "Instrumented element-to-source mapping",
                    ]
                  : [
                      "Expo development build connection",
                      "Supported component and request inspection",
                      "Reload and rebuild-aware verification",
                    ]
                ).map((item) => (
                  <div key={item}>
                    <Circle size={12} />
                    <span>{item}</span>
                    <span>Planned</span>
                  </div>
                ))}
              </div>
              <button
                className="primary-button"
                onClick={() => setTarget("web")}
              >
                Return to the working web fixture
                <ArrowRight size={14} />
              </button>
            </div>
          ) : (
            <>
              {previewProblem && (
                <div className="error-banner" role="alert">
                  <span>{previewProblem}</span>
                  <button onClick={() => setMode("Build")}>Open source</button>
                </div>
              )}
              {workspace.mappingSupported === false && (
                <div className="mapping-banner">
                  <ShieldCheck size={14} />
                  <span>
                    The source has been customized. Fixture relationships are
                    unverified; scripted changes are unavailable.
                  </span>
                </div>
              )}
              <section
                className={`primary-surface ${mode === "Build" ? "code-surface" : ""} ${mode === "Review" ? "review-surface" : ""}`}
                aria-label={`${mode} workspace`}
              >
                <div className="surface-toolbar">
                  <div className="surface-title">
                    {mode === "Build" ? (
                      <FileCode2 size={14} />
                    ) : mode === "Review" ? (
                      <GitBranch size={14} />
                    ) : (
                      <Monitor size={14} />
                    )}
                    <span>
                      {mode === "Build"
                        ? "SaveButton.tsx"
                        : mode === "Review"
                          ? "Change review"
                          : "Product preview"}
                    </span>
                    {dirty && mode === "Build" && (
                      <span className="unsaved-dot" />
                    )}
                    {mode === "Refine" && experiment && (
                      <span className="experiment-label">
                        Unsaved experiment
                      </span>
                    )}
                  </div>
                  <div className="surface-actions">
                    {mode === "Build" ? (
                      <>
                        {dirty && (
                          <button
                            className="text-button"
                            disabled={!!busy}
                            onClick={() => {
                              setSource(workspace.source);
                              sourceRef.current = workspace.source;
                              setDirty(false);
                              dirtyRef.current = false;
                              draftRevision.current = workspace.revision;
                            }}
                          >
                            Discard draft
                          </button>
                        )}
                        <button
                          className="mini-button"
                          disabled={!dirty || !!busy}
                          onClick={() => void saveSource()}
                        >
                          <Check size={12} />
                          Save source
                        </button>
                      </>
                    ) : mode === "Review" ? (
                      <span className="quiet-text">
                        {workspace.proposal
                          ? "1 file · managed fixture"
                          : "No proposed changes"}
                      </span>
                    ) : (
                      <>
                        <span className="preview-address">
                          <span />
                          localhost / settings
                        </span>
                        <IconButton
                          label={
                            focusPreview ? "Restore panels" : "Focus preview"
                          }
                          active={focusPreview}
                          onClick={() => setFocusPreview((v) => !v)}
                        >
                          <Maximize2 size={13} />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
                {mode === "Build" ? (
                  <div className="editor-container">
                    <Suspense
                      fallback={
                        <div className="loading-workspace">
                          Opening source editor…
                        </div>
                      }
                    >
                      <SourceEditor
                        source={source}
                        path={workspace.sourcePath}
                        theme={theme}
                        readOnly={!!busy}
                        onChange={(value) => {
                          if (!dirtyRef.current)
                            draftRevision.current = workspace.revision;
                          sourceRef.current = value;
                          dirtyRef.current = value !== workspace.source;
                          setSource(value);
                          setDirty(dirtyRef.current);
                        }}
                        onSave={() => void saveSource()}
                      />
                    </Suspense>
                  </div>
                ) : mode === "Review" ? (
                  workspace.proposal ? (
                    <>
                      <div className="review-heading">
                        <div>
                          <div className="review-status">
                            <span
                              className={`status-light ${workspace.proposal.status === "applied" ? "" : "pending"}`}
                            />
                            {workspace.proposal.status === "applied"
                              ? "Applied to source"
                              : workspace.proposal.baseRevision !==
                                  workspace.revision
                                ? "Source changed · prepare a fresh proposal"
                                : "Ready for your review"}
                          </div>
                          <h2>{workspace.proposal.title}</h2>
                          <p>{workspace.proposal.summary}</p>
                        </div>
                      </div>
                      <div className="diff-file">
                        <FileCode2 size={13} />
                        fixtures/web/src/SaveButton.tsx<span>Source diff</span>
                      </div>
                      <div className="diff-container">
                        <Suspense
                          fallback={
                            <div className="loading-workspace">
                              Preparing source diff…
                            </div>
                          }
                        >
                          <DiffViewer
                            before={workspace.proposal.before}
                            after={workspace.proposal.after}
                            theme={theme}
                          />
                        </Suspense>
                      </div>
                      <div className="review-actions">
                        <span>
                          <ShieldCheck size={13} />
                          Revision {workspace.proposal.baseRevision.slice(0, 7)}
                        </span>
                        <div>
                          {workspace.proposal.status === "applied" ? (
                            <>
                              <button
                                className="secondary-button"
                                disabled={!!busy}
                                onClick={() => void undo()}
                              >
                                <RotateCcw size={13} />
                                Undo change
                              </button>
                              <button
                                className="primary-button"
                                disabled={!!busy}
                                onClick={() => void verify()}
                              >
                                {busy ? (
                                  <Loader2 size={13} className="spin" />
                                ) : (
                                  <CheckCheck size={14} />
                                )}
                                Verify source
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="secondary-button"
                                onClick={() => setMode("Understand")}
                              >
                                Back to product
                              </button>
                              {workspace.undoAvailable && (
                                <button
                                  className="secondary-button"
                                  disabled={!!busy}
                                  onClick={() => void undo()}
                                >
                                  <RotateCcw size={13} />
                                  Undo previous change
                                </button>
                              )}
                              {workspace.proposal.baseRevision !==
                                workspace.revision && (
                                <button
                                  className="secondary-button"
                                  disabled={
                                    !!busy ||
                                    workspace.mappingSupported === false
                                  }
                                  onClick={() => void propose()}
                                >
                                  Prepare fresh proposal
                                </button>
                              )}
                              <button
                                className="primary-button"
                                disabled={
                                  !!busy ||
                                  workspace.proposal.baseRevision !==
                                    workspace.revision
                                }
                                onClick={() => void apply()}
                              >
                                {busy ? (
                                  <Loader2 className="spin" size={13} />
                                ) : (
                                  <Check size={14} />
                                )}
                                Apply to source
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="empty-review">
                      <GitBranch size={32} />
                      <h2>Make the next change with context.</h2>
                      <p>
                        Explore a loading and error state for this Save button.
                        Review the exact source change before applying it.
                      </p>
                      <button
                        className="primary-button"
                        onClick={() => void propose()}
                        disabled={!!busy}
                      >
                        <Sparkles size={14} />
                        Prepare example change
                      </button>
                      <span>Scripted proposal · no model connected</span>
                    </div>
                  )
                ) : (
                  <>
                    <div
                      className={`preview-stage ${viewport === "mobile" ? "mobile-stage" : ""}`}
                    >
                      <div
                        className={`product-frame ${viewport === "mobile" ? "mobile-frame" : ""}`}
                      >
                        <div className="product-topbar">
                          <span className="orbit-wordmark">
                            <span className="orbit-symbol" />
                            orbit
                          </span>
                          <div className="product-breadcrumb">
                            Workspace
                            <ChevronRight size={11} />
                            Settings
                          </div>
                          <div className="product-avatar-small">AM</div>
                        </div>
                        <div className="product-layout">
                          <aside className="product-sidebar">
                            <span>Workspace</span>
                            <button
                              className={
                                previewTab === "Profile" ? "current" : ""
                              }
                              onClick={() => setPreviewTab("Profile")}
                            >
                              <span className="tiny-person" />
                              Profile
                            </button>
                            <button
                              className={
                                previewTab === "Preferences" ? "current" : ""
                              }
                              onClick={() => setPreviewTab("Preferences")}
                            >
                              <Settings2 size={13} />
                              Preferences
                            </button>
                            <div className="product-sidebar-bottom">
                              <span className="avatar-dot">A</span>
                              <span>
                                Alex’s workspace<small>Personal plan</small>
                              </span>
                            </div>
                          </aside>
                          <div className="product-content">
                            {previewTab === "Profile" ? (
                              <>
                                <div className="product-heading">
                                  <h1>Your profile</h1>
                                  <p>
                                    A little about you, for the people you work
                                    with.
                                  </p>
                                </div>
                                <div className="profile-avatar-line">
                                  <div className="profile-avatar">AM</div>
                                  <div>
                                    <strong>Profile photo</strong>
                                    <p>Your initials keep things personal.</p>
                                  </div>
                                </div>
                                <div className="profile-fields">
                                  <label>
                                    Full name
                                    <input
                                      value={name}
                                      onChange={(event) =>
                                        setName(event.target.value)
                                      }
                                    />
                                  </label>
                                  <label>
                                    Email address
                                    <input
                                      type="email"
                                      value={email}
                                      onChange={(event) =>
                                        setEmail(event.target.value)
                                      }
                                    />
                                    <small>
                                      We’ll use this for updates about your
                                      workspace.
                                    </small>
                                  </label>
                                </div>
                                <div className="product-save-row">
                                  <span>
                                    Changes are saved to this local fixture.
                                  </span>
                                  <div
                                    ref={saveRef}
                                    className={`selected-element ${experiment ? "experiment" : ""}`}
                                    style={
                                      experiment
                                        ? ({
                                            "--fixture-radius": `${radius}px`,
                                            "--fixture-padding": `${padding}px`,
                                          } as CSSProperties)
                                        : undefined
                                    }
                                    onPointerDown={() => {
                                      setSelection("component");
                                    }}
                                  >
                                    <span className="selection-tag">
                                      <Component size={10} />
                                      SaveButton
                                    </span>
                                    <FixtureBoundary
                                      key={workspace.revision}
                                      onRecover={() => setMode("Build")}
                                    >
                                      <SaveButton onSave={saveProfile} />
                                    </FixtureBoundary>
                                    <i className="selection-handle tl" />
                                    <i className="selection-handle tr" />
                                    <i className="selection-handle bl" />
                                    <i className="selection-handle br" />
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="preferences-content">
                                <h1>Your preferences</h1>
                                <p>
                                  This fixture keeps the focus on the profile
                                  saving workflow.
                                </p>
                                <button
                                  onClick={() => setPreviewTab("Profile")}
                                >
                                  Return to profile
                                  <ArrowRight size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="preview-controls">
                      <div className="viewport-controls">
                        <button
                          className={viewport === "desktop" ? "selected" : ""}
                          aria-label="Desktop viewport"
                          onClick={() => setViewport("desktop")}
                        >
                          <Monitor size={14} />
                        </button>
                        <button
                          className={viewport === "mobile" ? "selected" : ""}
                          aria-label="Mobile viewport"
                          onClick={() => setViewport("mobile")}
                        >
                          <Smartphone size={14} />
                        </button>
                        <span>
                          {viewport === "desktop"
                            ? "Responsive desktop"
                            : "390 px"}
                        </span>
                      </div>
                      <div className="scenario-controls">
                        <select
                          aria-label="Scenario"
                          value={scenario}
                          onChange={(event) =>
                            setScenario(
                              event.target.value as "success" | "error",
                            )
                          }
                        >
                          <option value="success">Successful save</option>
                          <option value="error">Request fails</option>
                        </select>
                        <button disabled={running} onClick={runScenario}>
                          {running ? (
                            <Loader2 size={12} className="spin" />
                          ) : (
                            <Play size={12} />
                          )}
                          Run scenario
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>

              {showBottom && (
                <section className="evidence-panel" aria-label="Evidence panel">
                  <div className="evidence-tabs">
                    {(["Trace", "Network", "Checks", "Activity"] as const).map(
                      (tab) => (
                        <button
                          key={tab}
                          className={bottom === tab ? "selected" : ""}
                          onClick={() => setBottom(tab)}
                        >
                          {tab === "Trace" ? (
                            <Waypoints size={13} />
                          ) : tab === "Network" ? (
                            <Radio size={13} />
                          ) : tab === "Checks" ? (
                            <ShieldCheck size={13} />
                          ) : (
                            <Terminal size={13} />
                          )}
                          <span>{tab}</span>
                          {tab === "Network" && requests.length > 0 && (
                            <span className="tab-count">{requests.length}</span>
                          )}
                        </button>
                      ),
                    )}
                    <span className="evidence-caption">
                      {bottom === "Trace"
                        ? "Follow the selected interaction"
                        : bottom === "Network"
                          ? "Real requests · local runtime"
                          : bottom === "Checks"
                            ? "Evidence, with its limits"
                            : "Local session"}
                    </span>
                    <IconButton
                      label="Hide evidence panel"
                      onClick={() => setShowBottom(false)}
                    >
                      <X size={13} />
                    </IconButton>
                  </div>
                  {bottom === "Trace" ? (
                    <div className="trace-content">
                      <div className="trace-path">
                        <button
                          className={`trace-node ${selection === "component" ? "selected" : ""}`}
                          onClick={() => {
                            setSelection("component");
                            setPanel("details");
                          }}
                        >
                          <Component size={17} />
                          <div>
                            <strong>SaveButton</strong>
                            <span>React component</span>
                          </div>
                          <Provenance
                            kind={
                              workspace.mappingSupported === false
                                ? "unknown"
                                : "source"
                            }
                          />
                        </button>
                        <ArrowRight size={14} className="trace-arrow" />
                        <button
                          className={`trace-node ${selection === "handler" ? "selected" : ""}`}
                          onClick={() => {
                            setSelection("handler");
                            setMode("Build");
                          }}
                        >
                          <Code2 size={17} />
                          <div>
                            <strong>onSave()</strong>
                            <span>Action callback</span>
                          </div>
                          <Provenance
                            kind={
                              workspace.mappingSupported === false
                                ? "unknown"
                                : "source"
                            }
                          />
                        </button>
                        <ArrowRight size={14} className="trace-arrow" />
                        <button
                          className={`trace-node ${selection === "request" ? "selected" : ""}`}
                          onClick={() => {
                            setSelection("request");
                            setBottom("Network");
                          }}
                        >
                          <Radio size={17} />
                          <div>
                            <strong>/api/profile</strong>
                            <span>POST request</span>
                          </div>
                          <Provenance kind={latest ? "observed" : "unknown"} />
                        </button>
                      </div>
                      <div className="trace-note">
                        <Link2 size={12} />
                        <span>
                          {latest
                            ? `Request observed in this fixture. Server internals beyond the local handler are not traced.`
                            : "Run the scenario to connect source context to a real request."}
                        </span>
                        <button onClick={runScenario} disabled={running}>
                          Follow the action
                          <ArrowUpRight size={12} />
                        </button>
                      </div>
                    </div>
                  ) : bottom === "Network" ? (
                    <div className="network-content">
                      {requests.length ? (
                        <>
                          <div className="request-table-head">
                            <span>Request</span>
                            <span>Status</span>
                            <span>Duration</span>
                            <span>Evidence</span>
                          </div>
                          {requests.slice(0, 3).map((request) => (
                            <button
                              className="request-row"
                              key={request.id}
                              onClick={() => {
                                setSelectedRequestId(request.id);
                                setSelection("request");
                                setPanel("details");
                              }}
                            >
                              <span>
                                <em>POST</em>
                                {request.path}
                              </span>
                              <span
                                className={
                                  request.status < 400
                                    ? "status-success"
                                    : "status-error"
                                }
                              >
                                {request.status}
                              </span>
                              <span>{Math.round(request.durationMs)} ms</span>
                              <span>
                                {request.revision !== workspace.revision
                                  ? "Stale revision"
                                  : "Observed"}
                                <ArrowUpRight size={12} />
                              </span>
                            </button>
                          ))}
                        </>
                      ) : (
                        <div className="inline-empty">
                          <Radio size={20} />
                          <div>
                            <strong>No requests observed yet</strong>
                            <p>
                              Run the Save scenario to capture a real local
                              request.
                            </p>
                          </div>
                          <button onClick={runScenario}>
                            <Play size={12} />
                            Run scenario
                          </button>
                        </div>
                      )}
                    </div>
                  ) : bottom === "Checks" ? (
                    <div className="checks-content">
                      {workspace.verification ? (
                        <>
                          {verificationStale && (
                            <div className="stale-note">
                              Source changed after these checks. Run
                              verification again.
                            </div>
                          )}
                          {workspace.verification.checks.map((check) => (
                            <div className="check-row" key={check.name}>
                              {check.status === "passed" ? (
                                <Check size={14} className="status-success" />
                              ) : check.status === "failed" ? (
                                <X size={14} className="status-error" />
                              ) : (
                                <Circle size={13} />
                              )}
                              <strong>{check.name}</strong>
                              <span title={check.detail}>{check.detail}</span>
                              <em>
                                {check.status === "not-run"
                                  ? "Not run"
                                  : check.status === "passed"
                                    ? "Passed"
                                    : "Failed"}
                              </em>
                            </div>
                          ))}
                        </>
                      ) : (
                        <div className="inline-empty">
                          <ShieldCheck size={21} />
                          <div>
                            <strong>Checks have not been run</strong>
                            <p>
                              Run TypeScript against the real source. Visual
                              review stays separate.
                            </p>
                          </div>
                          <button
                            onClick={() => void verify()}
                            disabled={!!busy}
                          >
                            {busy ? (
                              <Loader2 size={13} className="spin" />
                            ) : (
                              <Play size={12} />
                            )}
                            Run checks
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="activity-log">
                      {activity.slice(-5).map((item, index) => (
                        <div key={`${index}-${item}`}>
                          <span>›</span>
                          {item}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </main>

        <aside className="inspector">
          <div
            className="resize-handle inspector-handle"
            role="separator"
            aria-label="Resize inspector"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={(event) => resize("inspector", event)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft")
                setInspectorWidth((v) => Math.min(440, v + 10));
              if (event.key === "ArrowRight")
                setInspectorWidth((v) => Math.max(270, v - 10));
            }}
          />
          <div className="inspector-tabs">
            <button
              onClick={() => setPanel("details")}
              className={panel === "details" ? "selected" : ""}
            >
              <Settings2 size={13} />
              Inspector
            </button>
            <button
              onClick={() => setPanel("assistant")}
              className={panel === "assistant" ? "selected" : ""}
            >
              <Sparkles size={13} />
              Assistant
            </button>
            <IconButton
              label="Open command menu"
              onClick={() => setShowPalette(true)}
            >
              <MoreHorizontal size={16} />
            </IconButton>
          </div>
          <div className="inspector-scroll">
            {panel === "details" ? (
              <>
                <div className="selection-summary">
                  <span className="selection-icon">
                    {selection === "request" ? (
                      <Radio size={20} />
                    ) : (
                      <Component size={20} />
                    )}
                  </span>
                  <div>
                    <h2>
                      {selection === "request" ? "Save profile" : "SaveButton"}
                    </h2>
                    <span>
                      {selection === "request"
                        ? "API interaction"
                        : "React component"}
                    </span>
                  </div>
                  <Provenance
                    kind={
                      selection === "request"
                        ? latest
                          ? "observed"
                          : "unknown"
                        : "source"
                    }
                  />
                </div>
                <div className="inspector-section">
                  <h3>Source</h3>
                  <button
                    className="source-link"
                    onClick={() => {
                      setMode("Build");
                      setNavTab("Files");
                    }}
                  >
                    <FileCode2 size={14} />
                    <span>
                      SaveButton.tsx<small>fixtures / web / src</small>
                    </span>
                    <ArrowUpRight size={13} />
                  </button>
                  <div className="property-line">
                    <span>Revision</span>
                    <code>{workspace?.revision.slice(0, 7) || "—"}</code>
                  </div>
                  <div className="property-line">
                    <span>Mapping</span>
                    <span className="value-with-dot">
                      <i />
                      {workspace?.mappingSupported === false
                        ? "Unverified after edit"
                        : "Explicit fixture"}
                    </span>
                  </div>
                </div>
                {selection === "request" ? (
                  <div className="inspector-section">
                    <h3>
                      {selectedRequestId
                        ? "Selected request"
                        : "Latest request"}
                    </h3>
                    {latest ? (
                      <>
                        <div className="property-line">
                          <span>Method</span>
                          <code>POST</code>
                        </div>
                        <div className="property-line">
                          <span>Endpoint</span>
                          <code>/api/profile</code>
                        </div>
                        <div className="property-line">
                          <span>Status</span>
                          <span
                            className={
                              latest.status < 400
                                ? "status-success"
                                : "status-error"
                            }
                          >
                            {latest.status}
                          </span>
                        </div>
                        <div className="property-line">
                          <span>Duration</span>
                          <span>{Math.round(latest.durationMs)} ms</span>
                        </div>
                        {sourceStale && (
                          <p className="stale-note">
                            Captured before the current source revision.
                          </p>
                        )}
                        <pre className="response-body">
                          {JSON.stringify(latest.response, null, 2)}
                        </pre>
                        <p className="inspector-hint">
                          Observed locally. No external service or database
                          trace is available.
                        </p>
                      </>
                    ) : (
                      <p className="inspector-hint">
                        Run the scenario to observe its request and response.
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="inspector-section">
                      <h3>
                        Behavior<span className="section-count">1 action</span>
                      </h3>
                      <div className="behavior-row">
                        <span className="event-chip">onClick</span>
                        <ArrowRight size={12} />
                        <button
                          onClick={() => {
                            setMode("Build");
                            setSelection("handler");
                          }}
                        >
                          onSave()
                          <ArrowUpRight size={11} />
                        </button>
                      </div>
                      <p className="inspector-hint">
                        Saves the profile through its parent callback. Run it to
                        inspect the request.
                      </p>
                    </div>
                    <div className="inspector-section">
                      <h3>
                        {mode === "Refine"
                          ? "Visual properties"
                          : "Design properties"}
                        <button
                          className="text-button"
                          onClick={() => setMode("Refine")}
                        >
                          {mode === "Refine" ? "Preview" : "Refine"}
                          <ArrowUpRight size={11} />
                        </button>
                      </h3>
                      <div className="property-line">
                        <span>Background</span>
                        <span className="color-property">
                          <i />
                          #525DD5
                        </span>
                      </div>
                      <div className="property-line">
                        <span>Corner radius</span>
                        {mode === "Refine" ? (
                          <label className="number-control">
                            <input
                              aria-label="Corner radius"
                              type="number"
                              min="0"
                              max="20"
                              value={radius}
                              onChange={(event) => {
                                setRadius(
                                  Math.max(
                                    0,
                                    Math.min(20, Number(event.target.value)),
                                  ),
                                );
                                setExperiment(true);
                              }}
                            />
                            <span>px</span>
                          </label>
                        ) : (
                          <span>{radius} px</span>
                        )}
                      </div>
                      {mode === "Refine" && (
                        <input
                          className="property-slider"
                          aria-label="Radius slider"
                          type="range"
                          min="0"
                          max="20"
                          value={radius}
                          onChange={(event) => {
                            setRadius(Number(event.target.value));
                            setExperiment(true);
                          }}
                        />
                      )}
                      <div className="property-line">
                        <span>Inline padding</span>
                        {mode === "Refine" ? (
                          <label className="number-control">
                            <input
                              aria-label="Inline padding"
                              type="number"
                              min="8"
                              max="32"
                              value={padding}
                              onChange={(event) => {
                                setPadding(
                                  Math.max(
                                    8,
                                    Math.min(32, Number(event.target.value)),
                                  ),
                                );
                                setExperiment(true);
                              }}
                            />
                            <span>px</span>
                          </label>
                        ) : (
                          <span>{padding} px</span>
                        )}
                      </div>
                      <div className="property-line">
                        <span>Edit scope</span>
                        <span>Component</span>
                      </div>
                      {mode === "Refine" && (
                        <>
                          <p className="inspector-hint">
                            Preview an experiment, then review its source
                            change.
                          </p>
                          <button
                            className="secondary-button full-width"
                            disabled={!experiment || !!busy}
                            onClick={() => void propose("visual")}
                          >
                            <GitBranch size={13} />
                            Review visual change
                          </button>
                          {experiment && (
                            <button
                              className="text-button reset-experiment"
                              onClick={() => {
                                setRadius(7);
                                setPadding(17);
                                setExperiment(false);
                              }}
                            >
                              Reset experiment
                            </button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="inspector-section">
                      <h3>
                        Scenarios<span className="section-count">2</span>
                      </h3>
                      <button
                        className={`scenario-row ${scenario === "success" ? "selected" : ""}`}
                        onClick={() => setScenario("success")}
                      >
                        <span className="scenario-dot success" />
                        Successful save
                        <ChevronRight size={12} />
                      </button>
                      <button
                        className={`scenario-row ${scenario === "error" ? "selected" : ""}`}
                        onClick={() => setScenario("error")}
                      >
                        <span className="scenario-dot failure" />
                        Request fails
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </>
                )}
                <div className="inspector-section provenance-note">
                  <ShieldCheck size={15} />
                  <p>
                    Every connection has a source.
                    <br />
                    <span>What we can’t verify stays visible.</span>
                  </p>
                </div>
              </>
            ) : (
              <div className="assistant-conversation">
                <div className="assistant-heading">
                  <span className="assistant-avatar">
                    <Logo />
                  </span>
                  <div>
                    <strong>Your context, connected.</strong>
                    <span>SaveButton · Orbit</span>
                  </div>
                </div>
                <div className="assistant-message">
                  <p>
                    This button calls <code>onSave()</code>. In this fixture,
                    its parent sends a <code>POST</code> request to{" "}
                    <code>/api/profile</code>.
                  </p>
                  <p>
                    We can add visible saving, success, and error states, then
                    check the result in the running product.
                  </p>
                  <div className="context-chip">
                    <FileCode2 size={11} />
                    SaveButton.tsx
                    <Provenance />
                  </div>
                </div>
                <div className="scripted-notice">
                  <Sparkles size={13} />
                  <span>
                    Scripted walkthrough
                    <br />
                    <small>A model provider is not connected.</small>
                  </span>
                </div>
                {workspace?.proposal && (
                  <div className="agent-plan">
                    <h3>
                      <GitBranch size={14} />
                      Proposed change
                    </h3>
                    <div>
                      <Check size={13} />
                      <span>Inspect the selected source</span>
                    </div>
                    <div>
                      <Check size={13} />
                      <span>Prepare a scoped component edit</span>
                    </div>
                    <div>
                      {workspace.proposal.status === "applied" ? (
                        <Check size={13} />
                      ) : (
                        <Circle size={12} />
                      )}
                      <span>Review and apply the source diff</span>
                    </div>
                    <div>
                      {workspace.verification?.checks[0]?.status === "passed" &&
                      !verificationStale ? (
                        <Check size={13} />
                      ) : (
                        <Circle size={12} />
                      )}
                      <span>Verify, then rerun the scenario</span>
                    </div>
                    <button
                      className="secondary-button full-width"
                      onClick={() => setMode("Review")}
                    >
                      Open change review
                      <ArrowRight size={13} />
                    </button>
                  </div>
                )}
                <div className="context-inspector">
                  <h3>Included context</h3>
                  <span>
                    <FileCode2 size={12} />
                    One source file
                  </span>
                  <span>
                    <Monitor size={12} />
                    Selected component
                  </span>
                  <span>
                    <Radio size={12} />
                    {requests.length} observed requests
                  </span>
                  <p>All fixture data stays on this machine.</p>
                </div>
              </div>
            )}
          </div>
          <div className="assistant-composer">
            <div className="composer-context">
              <Component size={12} />
              <span>SaveButton</span>
              <span className="composer-context-tag">Selected</span>
            </div>
            <p>Give this button a clear loading and error state.</p>
            <div className="composer-footer">
              <span>
                <Sparkles size={11} />
                Scripted example
              </span>
              <button
                aria-label="Draft change"
                onClick={() => void propose()}
                disabled={
                  !!busy ||
                  !workspace ||
                  target !== "web" ||
                  workspace.mappingSupported === false
                }
              >
                {busy ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <ArrowUpRight size={15} />
                )}
              </button>
            </div>
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <div>
          <span className="foundation-status">
            <Logo />
          </span>
          <span>
            <GitBranch size={12} />
            exploration
          </span>
          <span>
            <Circle size={9} />
            {workspace?.changed ? "Source modified" : "Fixture ready"}
          </span>
        </div>
        <button onClick={() => setShowSetup(true)}>
          Web feasibility prototype
          <span className="status-divider" />
          Native adapters planned
        </button>
        <div>
          <button onClick={() => setBottom("Activity")}>
            <Radio size={12} />
            {running ? "Observing request" : "Local"}
          </button>
          <span>TypeScript</span>
          <button onClick={() => setShowPalette(true)}>
            <Command size={11} />K
          </button>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {(showSetup || showPalette) && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowSetup(false);
              setShowPalette(false);
            }
          }}
        >
          <div
            ref={modalRef}
            className={`modal ${showPalette ? "command-modal" : "setup-modal"}`}
            role="dialog"
            aria-modal="true"
            aria-label={showPalette ? "Command menu" : "Project setup"}
          >
            {showPalette ? (
              <>
                <div className="command-input">
                  <Search size={19} />
                  <input
                    autoFocus
                    placeholder="Find a view, action, or setting…"
                    aria-label="Search commands"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        const command = commands.find((c) =>
                          c.title.toLowerCase().includes(query.toLowerCase()),
                        );
                        if (command) {
                          setShowPalette(false);
                          command.action();
                        }
                      }
                    }}
                  />
                  <kbd>esc</kbd>
                </div>
                <div className="command-list">
                  {commands
                    .filter((command) =>
                      command.title.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((command) => (
                      <button
                        key={command.title}
                        onClick={() => {
                          setShowPalette(false);
                          command.action();
                        }}
                      >
                        <span>{command.title}</span>
                        <small>{command.hint}</small>
                      </button>
                    ))}
                  {!commands.some((command) =>
                    command.title.toLowerCase().includes(query.toLowerCase()),
                  ) && <p className="no-commands">No matching commands.</p>}
                </div>
              </>
            ) : (
              <>
                <div className="modal-title">
                  <div>
                    <span className="subtle-label">Foundation workspace</span>
                    <h2>One project. Connected perspectives.</h2>
                  </div>
                  <IconButton
                    label="Close project setup"
                    onClick={() => setShowSetup(false)}
                  >
                    <X size={18} />
                  </IconButton>
                </div>
                <p className="modal-intro">
                  Orbit is a maintained fixture for exploring the full
                  interaction. Choose a target to see what is connected.
                </p>
                <div className="target-options">
                  {(["web", "swiftui", "expo"] as Target[]).map((item) => (
                    <button
                      className={target === item ? "selected" : ""}
                      key={item}
                      onClick={() => setTarget(item)}
                    >
                      {item === "web" ? (
                        <Globe2 size={22} />
                      ) : (
                        <Smartphone size={22} />
                      )}
                      <strong>
                        {item === "web"
                          ? "React web"
                          : item === "swiftui"
                            ? "SwiftUI"
                            : "React Native"}
                      </strong>
                      <span>
                        {item === "web"
                          ? "Working fixture"
                          : "Blueprint specification"}
                      </span>
                      {target === item && <Check size={15} />}
                    </button>
                  ))}
                </div>
                <div className="setup-stages">
                  {[
                    {
                      name: "Source",
                      detail:
                        target === "web"
                          ? "Managed React component"
                          : "Platform adapter specified",
                    },
                    {
                      name: "Build",
                      detail:
                        target === "web"
                          ? "Vite · TypeScript"
                          : "Native toolchain required",
                    },
                    {
                      name: "Runtime",
                      detail:
                        target === "web" ? "Local HTTP API" : "Not connected",
                    },
                    {
                      name: "Mapping",
                      detail:
                        target === "web"
                          ? "Explicit fixture metadata"
                          : "Instrumentation required",
                    },
                  ].map((stage) => (
                    <div key={stage.name}>
                      {target === "web" && workspace ? (
                        <Check size={15} />
                      ) : (
                        <Circle size={13} />
                      )}
                      <strong>{stage.name}</strong>
                      <span>{stage.detail}</span>
                    </div>
                  ))}
                </div>
                <div className="setup-boundary">
                  <ShieldCheck size={17} />
                  <p>
                    This is the blueprint’s web feasibility workbench. Real
                    source edits and local requests work here. General
                    repository import, Code OSS integration, model providers,
                    and native adapters are the next engineering gates.
                  </p>
                </div>
                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void refresh()}
                  >
                    <RotateCcw size={13} />
                    Check connection
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => setShowSetup(false)}
                  >
                    Open workspace
                    <ArrowRight size={14} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    localStorage.getItem("foundation-theme") === "light" ? "light" : "dark",
  );
  const [surface, setSurface] = useState<"project" | "walkthrough">(() =>
    new URLSearchParams(window.location.search).get("workspace") ===
    "walkthrough"
      ? "walkthrough"
      : "project",
  );
  const [visited, setVisited] = useState(() => ({
    project: surface === "project",
    walkthrough: surface === "walkthrough",
  }));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("foundation-theme", theme);
  }, [theme]);
  const switchTo = (next: "project" | "walkthrough") => {
    setVisited((current) => ({ ...current, [next]: true }));
    setSurface(next);
  };
  const toggleTheme = () =>
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  return (
    <>
      {visited.project && (
        <div
          hidden={surface !== "project"}
          inert={surface !== "project"}
          className="workspace-page"
        >
          <Suspense
            fallback={
              <div className="loading-workspace" style={{ height: "100dvh" }}>
                Opening Foundation…
              </div>
            }
          >
            <ProjectWorkbench
              theme={theme}
              onThemeChange={toggleTheme}
              onOpenWalkthrough={() => switchTo("walkthrough")}
              active={surface === "project"}
            />
          </Suspense>
        </div>
      )}
      {visited.walkthrough && (
        <div
          hidden={surface !== "walkthrough"}
          inert={surface !== "walkthrough"}
          className="workspace-page"
        >
          <Walkthrough
            theme={theme}
            onThemeChange={toggleTheme}
            onOpenProject={() => switchTo("project")}
            active={surface === "walkthrough"}
          />
        </div>
      )}
    </>
  );
}
