import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Component,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Layers2,
  Loader2,
  Moon,
  MousePointer2,
  PanelLeft,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Waypoints,
  X,
} from "lucide-react";
import type {
  FileAnalysis,
  ProjectChange,
  ProjectChanges,
  ProjectFile,
  ProjectSnapshot,
  SearchResults,
  WorkspaceActivity,
} from "./types";
import AssistantPanel from "./AssistantPanel";
import ProjectPreview from "./ProjectPreview";
import "./project.css";

const SourceEditor = lazy(() => import("../components/SourceEditor"));
const DiffViewer = lazy(() => import("../components/DiffViewer"));
type Tab = { file: ProjectFile; draft: string; conflict: ProjectFile | null };
type Dialog = "folder" | "files" | "conflict" | "close" | null;
type Props = {
  theme: "dark" | "light";
  onThemeChange: () => void;
  onOpenWalkthrough: () => void;
  active?: boolean;
};
const activities: {
  name: WorkspaceActivity;
  icon: typeof Code2;
  key: string;
}[] = [
  { name: "Understand", icon: Waypoints, key: "1" },
  { name: "Build", icon: Code2, key: "2" },
  { name: "Refine", icon: MousePointer2, key: "3" },
  { name: "Review", icon: CheckCheck, key: "4" },
];
class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
async function api<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    signal,
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error || `Request failed (${response.status}).`,
      data.code || "request-failed",
    );
  return data;
}
const endpoint = (kind: string, projectId: string, path?: string) =>
  `/api/project/${kind}?${new URLSearchParams({ projectId, ...(path ? { path } : {}) })}`;
const basename = (path: string) => path.split("/").at(-1) || path;
const parentPath = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "Project root";
const isDirty = (tab: Tab) => tab.draft !== tab.file.source;
function FileGlyph({ path, size = 14 }: { path: string; size?: number }) {
  return /\.(css|scss|sass|less)$/.test(path) ? (
    <span className="pw-file-glyph style">
      <Braces size={size} />
    </span>
  ) : /\.(ts|tsx|js|jsx|mjs)$/.test(path) ? (
    <span className="pw-file-glyph code">
      <FileCode2 size={size} />
    </span>
  ) : (
    <span className="pw-file-glyph">
      <FileText size={size} />
    </span>
  );
}
function EvidenceTag({ children = "From source" }: { children?: ReactNode }) {
  return (
    <span className="pw-evidence">
      <span />
      {children}
    </span>
  );
}
function Loading({
  children = "Opening workspace…",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="pw-loading" role="status">
      <Loader2 size={18} className="spin" />
      <span>{children}</span>
    </div>
  );
}

export default function ProjectWorkbench({
  theme,
  onThemeChange,
  onOpenWalkthrough,
  active = true,
}: Props) {
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  const [tabs, setTabs] = useState<Record<string, Tab>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [activity, setActivity] = useState<WorkspaceActivity>("Understand");
  const [sidebar, setSidebar] = useState<"files" | "search">("files");
  const [rail, setRail] = useState<"context" | "assistant">("context");
  const [navShown, setNavShown] = useState(false);
  const [panelWidths, setPanelWidths] = useState<{
    nav?: number;
    inspector?: number;
  }>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("foundation-project-layout-v1") || "{}",
      );
      return {
        nav:
          typeof saved.nav === "number"
            ? Math.min(320, Math.max(170, saved.nav))
            : undefined,
        inspector:
          typeof saved.inspector === "number"
            ? Math.min(430, Math.max(250, saved.inspector))
            : undefined,
      };
    } catch {
      return {};
    }
  });
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(["src", "src/components", "src/api", "src/styles"]),
  );
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [changes, setChanges] = useState<ProjectChange[]>([]);
  const [reviewPath, setReviewPath] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [folderPath, setFolderPath] = useState("");
  const [quickQuery, setQuickQuery] = useState("");
  const [quickIndex, setQuickIndex] = useState(0);
  const [dialogPath, setDialogPath] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [closeAfterDraft, setCloseAfterDraft] = useState(false);
  const [reveal, setReveal] = useState<{ line?: number; key: number }>({
    key: 0,
  });
  const projectRef = useRef(project);
  projectRef.current = project;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(activePath);
  activeRef.current = activePath;
  const orderRef = useRef(order);
  orderRef.current = order;
  const operationRef = useRef(false);
  const openSequence = useRef(0);
  const modalRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const navElement = useRef<HTMLElement>(null);
  const inspectorElement = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(
        "foundation-project-layout-v1",
        JSON.stringify(panelWidths),
      );
    } catch {
      /* Layout remains usable when storage is unavailable. */
    }
  }, [panelWidths]);
  const resizePanel = (
    side: "nav" | "inspector",
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const element = event.currentTarget,
      start = event.clientX;
    const initial =
      (side === "nav"
        ? navElement
        : inspectorElement
      ).current?.getBoundingClientRect().width || (side === "nav" ? 224 : 306);
    const min = side === "nav" ? 170 : 250,
      max = side === "nav" ? 320 : 430;
    element.setPointerCapture(event.pointerId);
    const move = (pointer: PointerEvent) =>
      setPanelWidths((previous) => ({
        ...previous,
        [side]: Math.min(
          max,
          Math.max(
            min,
            initial + (pointer.clientX - start) * (side === "nav" ? 1 : -1),
          ),
        ),
      }));
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
      element.removeEventListener("lostpointercapture", end);
    };
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
    element.addEventListener("lostpointercapture", end);
  };
  const separator = (side: "nav" | "inspector") => (
    <div
      className={`pw-resizer ${side}`}
      role="separator"
      aria-label={
        side === "nav" ? "Resize project navigator" : "Resize project context"
      }
      aria-orientation="vertical"
      aria-valuemin={side === "nav" ? 170 : 250}
      aria-valuemax={side === "nav" ? 320 : 430}
      aria-valuenow={panelWidths[side] || (side === "nav" ? 224 : 306)}
      tabIndex={0}
      onPointerDown={(event) => resizePanel(side, event)}
      onDoubleClick={() =>
        setPanelWidths((previous) => ({ ...previous, [side]: undefined }))
      }
      onKeyDown={(event) => {
        const min = side === "nav" ? 170 : 250,
          max = side === "nav" ? 320 : 430;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const measured =
          (side === "nav"
            ? navElement
            : inspectorElement
          ).current?.getBoundingClientRect().width ||
          (side === "nav" ? 224 : 306);
        setPanelWidths((previous) => ({
          ...previous,
          [side]:
            event.key === "Home"
              ? min
              : event.key === "End"
                ? max
                : Math.min(
                    max,
                    Math.max(
                      min,
                      (previous[side] || measured) +
                        (event.key === "ArrowRight" ? 10 : -10) *
                          (side === "nav" ? 1 : -1),
                    ),
                  ),
        }));
      }}
    />
  );
  const tab = activePath ? tabs[activePath] : null;
  const dirtyCount = Object.values(tabs).filter(isDirty).length;
  const file = tab?.file;
  const selectedChange =
    changes.find((change) => change.path === reviewPath) || changes[0];
  const styleFiles =
    project?.files.filter((entry) =>
      /\.(css|scss|sass|less)$/.test(entry.path),
    ) || [];
  const quickFiles = useMemo(() => {
    const text = quickQuery.trim().toLowerCase();
    return (project?.files || [])
      .filter((entry) => entry.path.toLowerCase().includes(text))
      .sort(
        (a, b) =>
          Number(basename(b.path).toLowerCase().startsWith(text)) -
            Number(basename(a.path).toLowerCase().startsWith(text)) ||
          a.path.localeCompare(b.path),
      )
      .slice(0, 60);
  }, [project, quickQuery]);
  const updateTabs = useCallback(
    (update: (previous: Record<string, Tab>) => Record<string, Tab>) => {
      setTabs((previous) => {
        const next = update(previous);
        tabsRef.current = next;
        return next;
      });
    },
    [],
  );
  const addTab = useCallback(
    (data: ProjectFile) => {
      updateTabs((previous) => ({
        ...previous,
        [data.path]: previous[data.path] || {
          file: data,
          draft: data.source,
          conflict: null,
        },
      }));
      setOrder((previous) => {
        const next = previous.includes(data.path)
          ? previous
          : [...previous, data.path];
        orderRef.current = next;
        return next;
      });
    },
    [updateTabs],
  );
  const refreshChanges = useCallback(async (id: string) => {
    const result = await api<ProjectChanges>(endpoint("changes", id));
    if (projectRef.current?.id === id) setChanges(result.changes);
  }, []);

  const openFile = useCallback(
    async (
      path: string,
      line?: number,
      nextActivity: WorkspaceActivity = "Build",
    ) => {
      const currentProject = projectRef.current;
      if (!currentProject) return;
      const sequence = ++openSequence.current;
      setError(null);
      setLoadingPath(path);
      try {
        const existing = tabsRef.current[path];
        const data =
          existing?.file ||
          (await api<ProjectFile>(endpoint("file", currentProject.id, path)));
        if (
          projectRef.current?.id !== currentProject.id ||
          sequence !== openSequence.current
        )
          return;
        addTab(data);
        setActivePath(path);
        activeRef.current = path;
        setActivity(nextActivity);
        setReveal((value) => ({ line, key: value.key + 1 }));
        setNavShown(false);
        const segments = path.split("/");
        setExpanded((previous) => {
          const next = new Set(previous);
          segments
            .slice(0, -1)
            .forEach((_, index) =>
              next.add(segments.slice(0, index + 1).join("/")),
            );
          return next;
        });
      } catch (failure) {
        if (sequence === openSequence.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to open this file.",
          );
      } finally {
        if (sequence === openSequence.current) setLoadingPath(null);
      }
    },
    [addTab],
  );

  const installProject = useCallback(
    async (data: ProjectSnapshot) => {
      projectRef.current = data;
      setProject(data);
      setFolderPath(data.root);
      tabsRef.current = {};
      orderRef.current = [];
      setTabs({});
      setOrder([]);
      setActivePath(null);
      activeRef.current = null;
      setChanges([]);
      setReviewPath(null);
      setSearch(null);
      setQuery("");
      setExpanded(new Set(["src", "src/components", "src/api", "src/styles"]));
      const first =
        data.files.find(
          (entry) => entry.path === "src/components/SaveButton.tsx",
        ) ||
        data.files.find((entry) => /\.(tsx?|jsx?)$/.test(entry.path)) ||
        data.files[0];
      if (first) await openFile(first.path, undefined, "Understand");
      await refreshChanges(data.id);
    },
    [openFile, refreshChanges],
  );

  useEffect(() => {
    const controller = new AbortController();
    api<ProjectSnapshot>("/api/project", undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          void installProject(data).catch((failure) =>
            setError(failure.message),
          );
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [installProject]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!dirtyCount) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirtyCount]);
  useEffect(() => {
    if (!project || !query.trim()) {
      setSearch(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      api<SearchResults>(
        `${endpoint("search", project.id)}&q=${encodeURIComponent(query)}`,
        undefined,
        controller.signal,
      )
        .then(setSearch)
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, project?.id]);
  useEffect(() => {
    if (!dialog) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const first = modalRef.current?.querySelector<HTMLElement>("input, button");
    first?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !operationRef.current) {
        setDialog(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) || [],
      );
      const start = focusable[0],
        end = focusable.at(-1);
      if (!start || !end) return;
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      }
      if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previousFocus.current?.focus();
    };
  }, [dialog]);
  useEffect(() => setQuickIndex(0), [quickQuery]);

  const saveFile = useCallback(
    async (path: string, reviewedDisk?: ProjectFile) => {
      const currentProject = projectRef.current,
        current = tabsRef.current[path];
      if (!currentProject || !current) return false;
      const draft = current.draft;
      try {
        const saved = await api<ProjectFile>("/api/project/file", {
          projectId: currentProject.id,
          path,
          source: draft,
          baseRevision: reviewedDisk?.revision || current.file.revision,
        });
        if (projectRef.current?.id !== currentProject.id) return false;
        updateTabs((previous) => ({
          ...previous,
          [path]: {
            file: saved,
            draft:
              previous[path]?.draft === draft
                ? saved.source
                : (previous[path]?.draft ?? saved.source),
            conflict: null,
          },
        }));
        await refreshChanges(currentProject.id);
        setNotice(`${basename(path)} saved to disk.`);
        return true;
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === "source-conflict") {
          try {
            const disk = await api<ProjectFile>(
              endpoint("file", currentProject.id, path),
            );
            if (projectRef.current?.id !== currentProject.id) return false;
            updateTabs((previous) =>
              previous[path]
                ? { ...previous, [path]: { ...previous[path], conflict: disk } }
                : previous,
            );
            setDialogPath(path);
            setDialog("conflict");
            setDialogError(null);
            setError(
              "This file changed on disk. Your draft is preserved. Compare both versions before saving.",
            );
          } catch (readFailure) {
            setError(
              readFailure instanceof Error
                ? `${readFailure.message} Your draft is preserved.`
                : "Unable to read the changed file. Your draft is preserved.",
            );
          }
        } else
          setError(
            failure instanceof Error
              ? failure.message
              : "The file could not be saved.",
          );
        return false;
      }
    },
    [refreshChanges, updateTabs],
  );
  const save = useCallback(async () => {
    const path = activeRef.current;
    if (
      !path ||
      operationRef.current ||
      !tabsRef.current[path] ||
      !isDirty(tabsRef.current[path])
    )
      return;
    operationRef.current = true;
    setBusy("Saving");
    setError(null);
    try {
      await saveFile(path);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Unable to save source.",
      );
    } finally {
      operationRef.current = false;
      setBusy(null);
    }
  }, [saveFile]);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        setQuickQuery("");
        setQuickIndex(0);
        setDialog("files");
        setDialogError(null);
      }
      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSidebar("search");
        setNavShown(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
      if (!dialog && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        const next = activities[Number(event.key) - 1].name;
        setActivity(next);
        if (next === "Review" && projectRef.current)
          void refreshChanges(projectRef.current.id).catch((failure) =>
            setError(failure.message),
          );
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, dialog, save, refreshChanges]);

  const refresh = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy("Refreshing");
    setError(null);
    try {
      const currentProject = projectRef.current;
      const data = await api<ProjectSnapshot>("/api/project");
      if (currentProject && data.id !== currentProject.id) {
        setError(
          "The active project changed in another window. Open a folder again to choose this workspace; your drafts are preserved.",
        );
        return;
      }
      setProject(data);
      projectRef.current = data;
      if (activeRef.current) {
        const path = activeRef.current,
          disk = await api<ProjectFile>(endpoint("file", data.id, path));
        updateTabs((previous) => {
          const current = previous[path];
          if (!current) return previous;
          return {
            ...previous,
            [path]: isDirty(current)
              ? {
                  ...current,
                  conflict:
                    disk.revision !== current.file.revision
                      ? disk
                      : current.conflict,
                }
              : { file: disk, draft: disk.source, conflict: null },
          };
        });
      }
      await refreshChanges(data.id);
      setNotice("File index and selected source refreshed.");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to refresh this workspace.",
      );
    } finally {
      operationRef.current = false;
      setBusy(null);
    }
  };
  const switchFolder = async (saveDrafts: boolean) => {
    if (operationRef.current || !folderPath.trim()) return;
    operationRef.current = true;
    setBusy("Opening folder");
    setDialogError(null);
    setError(null);
    try {
      if (saveDrafts)
        for (const [path, value] of Object.entries(tabsRef.current))
          if (isDirty(value) && !(await saveFile(path))) return;
      const next = await api<ProjectSnapshot>("/api/project/open", {
        root: folderPath.trim(),
      });
      await installProject(next);
      setDialog(null);
      setNotice(`Opened ${next.name}.`);
    } catch (failure) {
      setDialogError(
        failure instanceof Error
          ? failure.message
          : "Unable to open this folder.",
      );
    } finally {
      operationRef.current = false;
      setBusy(null);
    }
  };
  const removeTab = (path: string) => {
    const next = orderRef.current.filter((value) => value !== path);
    setOrder(next);
    orderRef.current = next;
    updateTabs((previous) => {
      const result = { ...previous };
      delete result[path];
      return result;
    });
    if (activeRef.current === path) {
      const nextPath = next.at(-1) || null;
      setActivePath(nextPath);
      activeRef.current = nextPath;
    }
  };
  const closeTab = (path: string) => {
    if (operationRef.current) return;
    if (isDirty(tabsRef.current[path])) {
      setCloseAfterDraft(true);
      setDialogPath(path);
      setDialog("close");
      setDialogError(null);
    } else removeTab(path);
  };
  const revert = async (change: ProjectChange) => {
    if (!project || operationRef.current) return;
    if (tabsRef.current[change.path] && isDirty(tabsRef.current[change.path])) {
      setError(
        "Save or discard this file’s draft before restoring its session version.",
      );
      return;
    }
    operationRef.current = true;
    setBusy("Restoring");
    setError(null);
    try {
      const restored = await api<ProjectFile>("/api/project/revert", {
        projectId: project.id,
        path: change.path,
        revision: change.revision,
      });
      updateTabs((previous) =>
        previous[change.path]
          ? {
              ...previous,
              [change.path]: {
                file: restored,
                draft: restored.source,
                conflict: null,
              },
            }
          : previous,
      );
      await refreshChanges(project.id);
      setNotice(
        `${basename(change.path)} restored to its first version in this session.`,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to restore source.",
      );
      await refreshChanges(project.id).catch(() => undefined);
    } finally {
      operationRef.current = false;
      setBusy(null);
    }
  };
  const changeActivity = (next: WorkspaceActivity) => {
    setActivity(next);
    if (next === "Review" && project)
      void refreshChanges(project.id).catch((failure) =>
        setError(failure.message),
      );
  };
  const openDialog = (kind: Dialog) => {
    setDialogError(null);
    setDialog(kind);
    if (kind === "folder") setFolderPath(project?.root || "");
  };

  const renderTree = (prefix = "", depth = 0): ReactNode => {
    const items =
      project?.files.filter((entry) => entry.path.startsWith(prefix)) || [];
    const directories = new Set<string>();
    const direct: string[] = [];
    items.forEach((entry) => {
      const remainder = entry.path.slice(prefix.length);
      if (remainder.includes("/")) directories.add(remainder.split("/")[0]);
      else direct.push(entry.path);
    });
    return (
      <>
        {Array.from(directories)
          .sort()
          .map((name) => {
            const path = `${prefix}${name}`,
              isExpanded = expanded.has(path);
            return (
              <div key={path}>
                <button
                  className="pw-tree-directory"
                  style={{ paddingLeft: 14 + depth * 13 }}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      next.has(path) ? next.delete(path) : next.add(path);
                      return next;
                    })
                  }
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                  {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
                  <span>{name}</span>
                </button>
                {isExpanded && renderTree(`${path}/`, depth + 1)}
              </div>
            );
          })}
        {direct.sort().map((path) => (
          <button
            key={path}
            className={`pw-tree-file ${path === activePath ? "selected" : ""}`}
            title={path}
            aria-label={`Open ${path}`}
            aria-current={path === activePath ? "page" : undefined}
            style={{ paddingLeft: 29 + depth * 13 }}
            onClick={() => void openFile(path)}
          >
            <FileGlyph path={path} />
            <span>{basename(path)}</span>
            {tabs[path] && isDirty(tabs[path]) ? (
              <span className="pw-dirty" title="Unsaved draft" />
            ) : changes.some((change) => change.path === path) ? (
              <span className="pw-modified">M</span>
            ) : null}
          </button>
        ))}
      </>
    );
  };

  return (
    <div
      className="project-workbench"
      data-testid="project-workbench"
      style={
        {
          ...(panelWidths.nav
            ? { "--pw-nav-width": `${panelWidths.nav}px` }
            : {}),
          ...(panelWidths.inspector
            ? { "--pw-inspector-width": `${panelWidths.inspector}px` }
            : {}),
        } as CSSProperties
      }
    >
      <header className="pw-titlebar">
        <div className="pw-brand">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="M3 5h18v4H7v3h11v4H7v5H3z" />
            <path fill="currentColor" opacity=".42" d="M11 18h10v3H11z" />
          </svg>
          <strong>Foundation</strong>
          <span>Local preview</span>
        </div>
        <button
          className="pw-project-picker"
          onClick={() => openDialog("folder")}
          title={project?.root}
        >
          <span className="pw-project-monogram">
            {project?.name[0]?.toUpperCase() || "F"}
          </span>
          <span>{project?.name || "Workspace"}</span>
          <ChevronDown size={12} />
        </button>
        <button
          className="pw-quick-open"
          onClick={() => {
            setQuickQuery("");
            openDialog("files");
          }}
          disabled={!project}
        >
          <Search size={13} />
          <span>Go to file…</span>
          <kbd>⌘ P</kbd>
        </button>
        <div className="pw-title-actions">
          <button
            onClick={onOpenWalkthrough}
            title="Open the connected Save walkthrough"
            className="pw-walkthrough-link"
          >
            <Layers2 size={14} />
            <span>Walkthrough</span>
          </button>
          <button
            className="pw-icon"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            onClick={onThemeChange}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>
      <div className="pw-toolbar">
        <button
          className="pw-icon pw-nav-toggle"
          aria-label="Toggle project navigator"
          aria-pressed={navShown}
          onClick={() => setNavShown((value) => !value)}
        >
          <PanelLeft size={16} />
        </button>
        <span className="pw-workspace-label">
          <FolderOpen size={14} />
          Local workspace
        </span>
        <nav aria-label="Project activity" className="pw-activities">
          {activities.map(({ name, icon: Icon, key }) => (
            <button
              key={name}
              aria-pressed={activity === name}
              className={activity === name ? "selected" : ""}
              title={`${name} · ⌘ ${key}`}
              onClick={() => changeActivity(name)}
            >
              <Icon size={14} />
              <span>{name}</span>
              {name === "Review" && changes.length > 0 && (
                <span className="pw-count">{changes.length}</span>
              )}
            </button>
          ))}
        </nav>
        <span className="pw-local-state">
          <span />
          On this Mac
        </span>
      </div>
      <div className={`pw-body ${navShown ? "nav-open" : ""}`}>
        <aside
          className="pw-navigator"
          aria-label="Project navigator"
          ref={navElement}
        >
          <div className="pw-pane-tabs">
            <button
              className={sidebar === "files" ? "selected" : ""}
              onClick={() => setSidebar("files")}
            >
              <Folder size={13} />
              Files
            </button>
            <button
              className={sidebar === "search" ? "selected" : ""}
              onClick={() => {
                setSidebar("search");
                requestAnimationFrame(() => searchRef.current?.focus());
              }}
            >
              <Search size={13} />
              Search
            </button>
            <button
              className="pw-icon"
              aria-label="Refresh project"
              onClick={() => void refresh()}
              disabled={!!busy}
            >
              <RefreshCw
                size={13}
                className={busy === "Refreshing" ? "spin" : ""}
              />
            </button>
          </div>
          {sidebar === "files" ? (
            <>
              <div className="pw-tree-heading">
                <span>{project?.name || "Project"}</span>
                <span>{project?.files.length ?? 0}</span>
              </div>
              <nav className="pw-tree" aria-label="File explorer">
                {project ? (
                  renderTree()
                ) : (
                  <p className="pw-pane-empty">Connecting to local files…</p>
                )}
                {project && project.files.length === 0 && (
                  <p className="pw-pane-empty">
                    No supported source files found in this folder.
                  </p>
                )}
              </nav>
            </>
          ) : (
            <div className="pw-search-pane">
              <label className="pw-search-input">
                <Search size={14} />
                <input
                  ref={searchRef}
                  aria-label="Search project files"
                  placeholder="Search source…"
                  maxLength={200}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="pw-search-meta">
                {searching
                  ? "Searching source…"
                  : search
                    ? `${search.matches.length}${search.truncated ? "+" : ""} matches`
                    : "Text search · saved files"}
              </div>
              <div className="pw-search-results" aria-live="polite">
                {search?.matches.map((match, index) => (
                  <button
                    key={`${match.path}:${match.line}:${index}`}
                    onClick={() => void openFile(match.path, match.line)}
                    title={match.path}
                  >
                    <span>
                      <FileGlyph path={match.path} />
                      <strong>{basename(match.path)}</strong>
                      <small>{match.line}</small>
                    </span>
                    <code>{match.text.trim()}</code>
                    <small>{parentPath(match.path)}</small>
                  </button>
                ))}
                {search && !search.matches.length && (
                  <p className="pw-pane-empty">
                    No matches. Try a function name, property, or request path.
                  </p>
                )}
                {!query && (
                  <p className="pw-pane-empty">
                    Follow an idea across your project. Search components, text,
                    styles, and API calls.
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="pw-navigator-footer">
            <button onClick={() => openDialog("folder")}>
              <FolderOpen size={14} />
              Open local folder
              <ArrowUpRight size={12} />
            </button>
            <p>
              {project?.truncated
                ? "Index limit reached. Some files are not shown."
                : "Source stays on your machine."}
            </p>
          </div>
          {separator("nav")}
        </aside>
        <main className="pw-main" aria-label={`${activity} project workspace`}>
          {error && (
            <div className="pw-alert" role="alert">
              <ShieldCheck size={15} />
              <span>{error}</span>
              <button
                aria-label="Dismiss project error"
                onClick={() => setError(null)}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {!project ? (
            <div className="pw-onboarding">
              <Loading />
              <p>Foundation reads source from a local folder.</p>
              {error && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setError(null);
                    api<ProjectSnapshot>("/api/project")
                      .then(installProject)
                      .catch((failure) => setError(failure.message));
                  }}
                >
                  Reconnect
                </button>
              )}
            </div>
          ) : (
            <>
              <div
                className="pw-editor-tabs"
                role="tablist"
                aria-label="Open files"
              >
                {order.map((path) => (
                  <div
                    key={path}
                    className={`pw-file-tab ${activePath === path ? "selected" : ""}`}
                  >
                    <button
                      role="tab"
                      aria-selected={activePath === path}
                      aria-label={`${basename(path)}${tabs[path] && isDirty(tabs[path]) ? ", unsaved" : ""}`}
                      onClick={() => {
                        setActivePath(path);
                        activeRef.current = path;
                        setReveal((value) => ({ key: value.key + 1 }));
                      }}
                    >
                      <FileGlyph path={path} />
                      <span>{basename(path)}</span>
                      {tabs[path] && isDirty(tabs[path]) && (
                        <span className="pw-dirty" />
                      )}
                    </button>
                    <button
                      aria-label={`Close ${path}`}
                      className="pw-tab-close"
                      onClick={() => closeTab(path)}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {!order.length && (
                  <span className="pw-no-tabs">Choose a file to begin</span>
                )}
              </div>
              {file && (
                <div className="pw-breadcrumb">
                  <span>{project.name}</span>
                  <ChevronRight size={11} />
                  <span>{parentPath(file.path)}</span>
                  <ChevronRight size={11} />
                  <strong>{basename(file.path)}</strong>
                  {tab && isDirty(tab) && (
                    <span className="pw-draft-label">Unsaved draft</span>
                  )}
                  <span className="pw-breadcrumb-spacer" />
                  <button
                    className="pw-icon"
                    aria-label="Refresh selected source"
                    disabled={!!busy}
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              )}
              {tab?.conflict && (
                <div className="pw-conflict-bar">
                  <ShieldCheck size={14} />
                  <span>Changed on disk. Your draft is preserved.</span>
                  <button
                    onClick={() => {
                      setDialogPath(activePath);
                      openDialog("conflict");
                    }}
                  >
                    Compare versions
                  </button>
                </div>
              )}
              {loadingPath && (
                <div className="pw-loading-strip" role="status">
                  <Loader2 size={12} className="spin" />
                  Opening {basename(loadingPath)}…
                </div>
              )}
              {!file || !tab ? (
                <div className="pw-empty-workspace">
                  <FolderOpen size={32} />
                  <h1>Your project, in context.</h1>
                  <p>
                    Open a file to inspect its source, relationships, and
                    changes.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => openDialog("files")}
                  >
                    Go to file<kbd>⌘ P</kbd>
                  </button>
                </div>
              ) : activity === "Build" ? (
                <>
                  <div className="pw-source-toolbar">
                    <span>
                      <Code2 size={13} />
                      {file.language}
                      <span className="pw-dot-divider">·</span>
                      <span>{tab.draft.split("\n").length} lines</span>
                    </span>
                    <div>
                      {isDirty(tab) && (
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            setCloseAfterDraft(false);
                            setDialogPath(file.path);
                            openDialog("close");
                          }}
                        >
                          Discard draft…
                        </button>
                      )}
                      <button
                        className="pw-save"
                        disabled={!isDirty(tab) || !!busy}
                        onClick={() => void save()}
                      >
                        {busy === "Saving" ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Check size={12} />
                        )}
                        Save file<kbd>⌘ S</kbd>
                      </button>
                    </div>
                  </div>
                  <div className="pw-editor">
                    <Suspense
                      fallback={<Loading>Opening source editor…</Loading>}
                    >
                      <SourceEditor
                        source={tab.draft}
                        path={`${project.id}/${file.path}`}
                        theme={theme}
                        readOnly={!!busy}
                        revealLine={reveal.line}
                        revealKey={reveal.key}
                        onChange={(value) => {
                          const path = file.path;
                          updateTabs((previous) =>
                            previous[path]
                              ? {
                                  ...previous,
                                  [path]: { ...previous[path], draft: value },
                                }
                              : previous,
                          );
                        }}
                        onSave={() => void save()}
                      />
                    </Suspense>
                  </div>
                </>
              ) : activity === "Understand" ? (
                <Understanding
                  file={file}
                  draft={isDirty(tab)}
                  onOpen={(path, line) => void openFile(path, line)}
                  onInspect={() => {
                    setRail("assistant");
                  }}
                />
              ) : activity === "Refine" ? (
                <div className="pw-refine">
                  <div className="pw-refine-heading">
                    <div>
                      <h1>Refine the running product</h1>
                      <p>
                        {project.preview
                          ? "Inspect the included app and follow an element back to its source."
                          : "Start with the project’s style sources. Runtime inspection needs an adapter."}
                      </p>
                    </div>
                    <EvidenceTag>
                      {project.preview ? "Connected preview" : "Source only"}
                    </EvidenceTag>
                  </div>
                  <div className="pw-style-files">
                    <span>
                      <Braces size={13} />
                      Style sources
                    </span>
                    {styleFiles.slice(0, 8).map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() => void openFile(entry.path)}
                        title={entry.path}
                      >
                        {basename(entry.path)}
                        <ArrowUpRight size={11} />
                      </button>
                    ))}
                    {styleFiles.length === 0 && (
                      <small>No CSS files in this index.</small>
                    )}
                  </div>
                  {project.preview ? (
                    <div className="pw-preview-host">
                      <ProjectPreview
                        theme={theme}
                        onOpenSource={(path, line) => void openFile(path, line)}
                      />
                    </div>
                  ) : (
                    <div className="pw-refine-unconnected">
                      <MousePointer2 size={32} />
                      <h2>Connect the interface to its source.</h2>
                      <p>
                        This folder’s runtime is not connected. You can edit
                        style sources now, or explore visual inspection in the
                        included walkthrough.
                      </p>
                      <button
                        className="secondary-button"
                        onClick={onOpenWalkthrough}
                      >
                        Open connected walkthrough
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="pw-review">
                  <div className="pw-review-heading">
                    <div>
                      <h1>Changes made here</h1>
                      <p>
                        Saved edits compared with each file’s first version in
                        this API session.
                      </p>
                    </div>
                    <span className="pw-review-total">
                      {changes.length} {changes.length === 1 ? "file" : "files"}
                    </span>
                  </div>
                  {changes.length === 0 ? (
                    <div className="pw-review-empty">
                      <CheckCheck size={30} />
                      <h2>A clear starting point.</h2>
                      <p>
                        {dirtyCount
                          ? "Your drafts stay in the editor until you save them. Save a file to review its exact changes here."
                          : "Edit and save a file to see its source changes here."}
                      </p>
                      <button
                        className="secondary-button"
                        onClick={() => setActivity("Build")}
                      >
                        Open source
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="pw-change-picker">
                        {changes.map((change) => (
                          <button
                            key={change.path}
                            className={
                              selectedChange?.path === change.path
                                ? "selected"
                                : ""
                            }
                            onClick={() => setReviewPath(change.path)}
                          >
                            <FileGlyph path={change.path} />
                            <span>{change.path}</span>
                            <small>
                              {change.conflict
                                ? "Changed outside Foundation"
                                : "Modified"}
                            </small>
                          </button>
                        ))}
                      </div>
                      {selectedChange && (
                        <>
                          <div className="pw-review-diff">
                            <Suspense
                              fallback={
                                <Loading>Preparing exact source diff…</Loading>
                              }
                            >
                              <DiffViewer
                                before={selectedChange.before}
                                after={selectedChange.after}
                                theme={theme}
                              />
                            </Suspense>
                          </div>
                          <div className="pw-review-footer">
                            <span>
                              <ShieldCheck size={13} />
                              {selectedChange.conflict
                                ? "External changes detected. Restore is blocked."
                                : "Changes are already saved on disk."}
                            </span>
                            <button
                              className="secondary-button"
                              disabled={
                                !!busy ||
                                selectedChange.conflict ||
                                Boolean(
                                  tabs[selectedChange.path] &&
                                  isDirty(tabs[selectedChange.path]),
                                )
                              }
                              onClick={() => void revert(selectedChange)}
                            >
                              <ArrowLeft size={12} />
                              Restore session version
                            </button>
                          </div>
                          <div className="pw-review-checks">
                            <span>
                              Compilation <b>Not run</b>
                            </span>
                            <span>
                              Interaction <b>Not run</b>
                            </span>
                            <span>
                              Visual <b>Not run</b>
                            </span>
                            <span>Session review · not a Git diff</span>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </main>
        <aside
          className="pw-inspector"
          aria-label="Project context"
          ref={inspectorElement}
        >
          {separator("inspector")}
          <div className="pw-pane-tabs">
            <button
              className={rail === "context" ? "selected" : ""}
              onClick={() => setRail("context")}
            >
              <Component size={13} />
              Context
            </button>
            <button
              className={rail === "assistant" ? "selected" : ""}
              onClick={() => setRail("assistant")}
            >
              <Sparkles size={13} />
              Assistant
            </button>
          </div>
          {project && (
            <div className="pw-assistant-host" hidden={rail !== "assistant"}>
              <AssistantPanel
                key={project.id}
                projectId={project.id}
                files={order
                  .map((path) => tabs[path]?.file)
                  .filter((entry): entry is ProjectFile => Boolean(entry))}
                activePath={activePath}
                onOpenSource={(path, line) => void openFile(path, line)}
              />
            </div>
          )}
          <div className="pw-context-host" hidden={rail !== "context"}>
            {file ? (
              <Inspector
                file={file}
                dirty={Boolean(tab && isDirty(tab))}
                project={project}
                onOpen={(path, line) => void openFile(path, line)}
              />
            ) : (
              <p className="pw-pane-empty">
                Select a file to see its source relationships.
              </p>
            )}
          </div>
        </aside>
      </div>
      <footer className="pw-status">
        <span>
          <span className="pw-status-dot" />
          {busy ||
            (project ? `${project.files.length} files indexed` : "Connecting")}
        </span>
        <span className="pw-status-divider" />
        <span>
          {dirtyCount
            ? `${dirtyCount} unsaved ${dirtyCount === 1 ? "file" : "files"}`
            : "All open files saved"}
        </span>
        <span className="pw-status-spacer" />
        <span>{file?.language || "Local workspace"}</span>
        <span className="pw-status-revision">
          {file ? `Revision ${file.revision.slice(0, 7)}` : ""}
        </span>
        <button onClick={() => setRail("assistant")}>
          <Sparkles size={12} />
          Context under your control
        </button>
      </footer>
      {notice && (
        <div className="pw-toast" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
      {dialog && (
        <div
          className="pw-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setDialog(null);
          }}
        >
          <div
            className={`pw-modal ${dialog === "files" ? "pw-quick-modal" : ""} ${dialog === "conflict" ? "pw-conflict-modal" : ""}`}
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label={
              dialog === "files"
                ? "Go to file"
                : dialog === "folder"
                  ? "Open local folder"
                  : dialog === "conflict"
                    ? "Source conflict"
                    : "Unsaved file"
            }
          >
            {dialog === "files" ? (
              <>
                <div className="pw-quick-search">
                  <Search size={17} />
                  <input
                    aria-label="Find a file"
                    placeholder="Search by filename or path…"
                    value={quickQuery}
                    onChange={(event) => setQuickQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setQuickIndex((index) =>
                          Math.min(quickFiles.length - 1, index + 1),
                        );
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setQuickIndex((index) => Math.max(0, index - 1));
                      }
                      if (event.key === "Enter" && quickFiles[quickIndex]) {
                        void openFile(quickFiles[quickIndex].path);
                        setDialog(null);
                      }
                    }}
                  />
                  <button
                    className="pw-icon"
                    aria-label="Close file picker"
                    onClick={() => setDialog(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="pw-quick-results">
                  {quickFiles.map((entry, index) => (
                    <button
                      key={entry.path}
                      className={index === quickIndex ? "selected" : ""}
                      onMouseEnter={() => setQuickIndex(index)}
                      onClick={() => {
                        void openFile(entry.path);
                        setDialog(null);
                      }}
                    >
                      <FileGlyph path={entry.path} />
                      <strong>{basename(entry.path)}</strong>
                      <span>{parentPath(entry.path)}</span>
                      {index === quickIndex && <ArrowDownLeft size={13} />}
                    </button>
                  ))}
                  {quickFiles.length === 0 && (
                    <p className="pw-pane-empty">No files match this path.</p>
                  )}
                </div>
                <div className="pw-modal-footnote">
                  <span>↑ ↓ navigate</span>
                  <span>↵ open</span>
                  <span>esc close</span>
                </div>
              </>
            ) : (
              <>
                <div className="pw-modal-heading">
                  <div>
                    <h2>
                      {dialog === "folder"
                        ? "Open a local folder"
                        : dialog === "conflict"
                          ? "Your draft and the current source"
                          : "Keep your changes?"}
                    </h2>
                    <p>
                      {dialog === "folder"
                        ? "Foundation indexes supported source files and edits only files you save."
                        : dialog === "conflict"
                          ? "Before is the current disk version. After is your unsaved draft."
                          : `${basename(dialogPath || "")} has unsaved changes.`}
                    </p>
                  </div>
                  <button
                    className="pw-icon"
                    aria-label="Close dialog"
                    disabled={!!busy}
                    onClick={() => setDialog(null)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {dialog === "folder" ? (
                  <>
                    <label className="pw-folder-input">
                      Folder path
                      <input
                        aria-label="Local folder path"
                        placeholder="/Users/you/Projects/my-app"
                        value={folderPath}
                        onChange={(event) => setFolderPath(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !dirtyCount)
                            void switchFolder(false);
                        }}
                      />
                    </label>
                    <div className="pw-folder-details">
                      <ShieldCheck size={16} />
                      <p>
                        Source and indexing stay local. Dependency folders,
                        hidden files, and unsupported files are excluded. No
                        project commands are run.
                      </p>
                    </div>
                    {dirtyCount > 0 && (
                      <div className="pw-unsaved-warning">
                        {dirtyCount} open{" "}
                        {dirtyCount === 1 ? "file has" : "files have"} unsaved
                        changes. Save them or discard the drafts before opening
                        another folder.
                      </div>
                    )}
                    {dialogError && (
                      <p className="pw-dialog-error" role="alert">
                        {dialogError}
                      </p>
                    )}
                    <div className="pw-modal-actions">
                      <button
                        className="secondary-button"
                        disabled={!!busy}
                        onClick={() => setDialog(null)}
                      >
                        Cancel
                      </button>
                      {dirtyCount > 0 && (
                        <button
                          className="secondary-button"
                          disabled={!!busy || !folderPath.trim()}
                          onClick={() => void switchFolder(false)}
                        >
                          Discard drafts and open
                        </button>
                      )}
                      <button
                        className="primary-button"
                        disabled={!!busy || !folderPath.trim()}
                        onClick={() => void switchFolder(dirtyCount > 0)}
                      >
                        {busy ? (
                          <Loader2 size={13} className="spin" />
                        ) : (
                          <FolderOpen size={13} />
                        )}
                        {dirtyCount ? "Save drafts and open" : "Open folder"}
                      </button>
                    </div>
                  </>
                ) : dialog === "conflict" &&
                  dialogPath &&
                  tabs[dialogPath]?.conflict ? (
                  <>
                    <div className="pw-conflict-diff">
                      <Suspense fallback={<Loading>Comparing source…</Loading>}>
                        <DiffViewer
                          before={tabs[dialogPath].conflict!.source}
                          after={tabs[dialogPath].draft}
                          theme={theme}
                        />
                      </Suspense>
                    </div>
                    <p className="pw-conflict-guidance">
                      Replacing disk writes the complete reviewed draft. Any
                      newer disk change will block the save again.
                    </p>
                    <div className="pw-modal-actions">
                      <button
                        className="secondary-button"
                        disabled={!!busy}
                        onClick={() => setDialog(null)}
                      >
                        Keep editing draft
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!!busy}
                        onClick={() => {
                          const path = dialogPath;
                          updateTabs((previous) => {
                            const disk = previous[path].conflict!;
                            return {
                              ...previous,
                              [path]: {
                                file: disk,
                                draft: disk.source,
                                conflict: null,
                              },
                            };
                          });
                          setDialog(null);
                          setError(null);
                        }}
                      >
                        Discard draft · use disk
                      </button>
                      <button
                        className="primary-button"
                        disabled={!!busy}
                        onClick={async () => {
                          if (operationRef.current) return;
                          operationRef.current = true;
                          setBusy("Saving reviewed draft");
                          try {
                            if (
                              await saveFile(
                                dialogPath,
                                tabs[dialogPath].conflict!,
                              )
                            ) {
                              setDialog(null);
                              setError(null);
                            }
                          } finally {
                            operationRef.current = false;
                            setBusy(null);
                          }
                        }}
                      >
                        Replace disk with draft
                      </button>
                    </div>
                  </>
                ) : dialog === "close" && dialogPath ? (
                  <>
                    <div className="pw-unsaved-warning">
                      Save this file to keep your edits. Discarding returns to
                      the last saved source.
                    </div>
                    <div className="pw-modal-actions">
                      <button
                        className="secondary-button"
                        disabled={!!busy}
                        onClick={() => setDialog(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!!busy}
                        onClick={() => {
                          const path = dialogPath;
                          updateTabs((previous) => ({
                            ...previous,
                            [path]: {
                              ...previous[path],
                              draft: previous[path].file.source,
                            },
                          }));
                          if (closeAfterDraft) removeTab(path);
                          setDialog(null);
                        }}
                      >
                        Discard draft
                      </button>
                      <button
                        className="primary-button"
                        disabled={!!busy}
                        onClick={async () => {
                          if (operationRef.current) return;
                          operationRef.current = true;
                          setBusy("Saving");
                          try {
                            if (await saveFile(dialogPath)) {
                              if (closeAfterDraft) removeTab(dialogPath);
                              setDialog(null);
                            }
                          } finally {
                            operationRef.current = false;
                            setBusy(null);
                          }
                        }}
                      >
                        Save file
                      </button>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Understanding({
  file,
  draft,
  onOpen,
  onInspect,
}: {
  file: ProjectFile;
  draft: boolean;
  onOpen: (path: string, line?: number) => void;
  onInspect: () => void;
}) {
  const fileStem = basename(file.path).replace(/\.[^.]+$/, "");
  const primary =
    file.analysis.symbols.find(
      (symbol) => symbol.exported && symbol.name === fileStem,
    ) || file.analysis.symbols.find((symbol) => symbol.name === fileStem);
  const title = primary?.name || basename(file.path);
  const excerptStart = Math.max(0, (primary?.line || 1) - 1);
  const excerpt = file.source
    .split("\n")
    .slice(excerptStart, excerptStart + 15);
  return (
    <div className="pw-understand">
      <div className="pw-understand-heading">
        <div>
          <div className="pw-eyebrow">
            <Component size={13} />
            Selected source
          </div>
          <h1>{title}</h1>
          <p>{file.path}</p>
        </div>
        <EvidenceTag />
      </div>
      {draft && (
        <div className="pw-source-note">
          Showing the saved revision. Save your draft to update relationships
          and AI context.
        </div>
      )}
      <div className="pw-relationship-title">
        <h2>A focused view of the system</h2>
        <span>Direct relationships only</span>
      </div>
      <div className="pw-relationships">
        <RelationshipColumn
          label="Depends on"
          count={file.analysis.imports.length}
        >
          {file.analysis.imports.length ? (
            file.analysis.imports.map((item, index) => (
              <button
                className="pw-relationship-item"
                key={`${item.specifier}:${index}`}
                onClick={() =>
                  item.resolvedPath
                    ? onOpen(item.resolvedPath)
                    : onOpen(file.path, item.line)
                }
              >
                <span className="pw-relation-icon">
                  {item.resolvedPath ? (
                    <FileCode2 size={15} />
                  ) : (
                    <Layers2 size={15} />
                  )}
                </span>
                <span>
                  <strong>
                    {item.resolvedPath
                      ? basename(item.resolvedPath)
                      : item.specifier}
                  </strong>
                  <small>
                    {item.resolvedPath
                      ? "Local import"
                      : "Package or unresolved import"}
                  </small>
                </span>
                <ArrowUpRight size={12} />
              </button>
            ))
          ) : (
            <p className="pw-relationship-empty">No static imports found.</p>
          )}
        </RelationshipColumn>
        <div className="pw-relationship-center">
          <div className="pw-connection-line" />
          <button
            className="pw-selected-entity"
            onClick={() => onOpen(file.path, primary?.line)}
          >
            <span className="pw-selected-glyph">
              <Component size={22} />
            </span>
            <strong>{title}</strong>
            <span>{primary?.kind || file.language}</span>
            <small>
              Open source <ArrowUpRight size={11} />
            </small>
          </button>
          <div className="pw-connection-line" />
        </div>
        <RelationshipColumn
          label="Used by"
          count={file.analysis.consumers.length}
        >
          {file.analysis.consumers.length ? (
            file.analysis.consumers.map((item) => (
              <button
                className="pw-relationship-item"
                key={`${item.path}:${item.line}`}
                onClick={() => onOpen(item.path, item.line)}
              >
                <span className="pw-relation-icon">
                  <FileCode2 size={15} />
                </span>
                <span>
                  <strong>{basename(item.path)}</strong>
                  <small>{parentPath(item.path)}</small>
                </span>
                <ArrowUpRight size={12} />
              </button>
            ))
          ) : (
            <p className="pw-relationship-empty">
              No direct consumers found in the indexed source.
            </p>
          )}
        </RelationshipColumn>
      </div>
      <div className="pw-understand-lower">
        <section className="pw-source-card">
          <div className="pw-card-heading">
            <h2>
              <Code2 size={13} />
              Source, in place
            </h2>
            <button onClick={() => onOpen(file.path, primary?.line)}>
              Open editor
              <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="pw-source-excerpt">
            {excerpt.map((line, index) => (
              <button
                key={index}
                onClick={() => onOpen(file.path, excerptStart + index + 1)}
              >
                <span>{excerptStart + index + 1}</span>
                <code>{line || " "}</code>
              </button>
            ))}
          </div>
        </section>
        <section className="pw-behavior-card">
          <div className="pw-card-heading">
            <h2>
              <Waypoints size={13} />
              Behavior references
            </h2>
          </div>
          {file.analysis.requests.length ? (
            <div className="pw-request-links">
              {file.analysis.requests.map((request, index) => (
                <button
                  key={index}
                  onClick={() => onOpen(file.path, request.line)}
                >
                  <span>{request.method}</span>
                  <code>{request.url}</code>
                  <ArrowUpRight size={12} />
                </button>
              ))}
              <p>
                Request declarations in source. No request has been observed
                here.
              </p>
            </div>
          ) : (
            <div className="pw-behavior-summary">
              <span className="pw-small-stat">
                {file.analysis.symbols.length}
                <small>source declarations</small>
              </span>
              <p>
                {file.analysis.unsupported
                  ? "Relationship analysis is available for JavaScript and TypeScript. This file remains fully editable."
                  : "Explore the declarations and imports to understand what this file does. Runtime behavior needs observation."}
              </p>
            </div>
          )}
          <button className="pw-ask-about" onClick={onInspect}>
            <Sparkles size={14} />
            <span>Ask about this source</span>
            <ArrowRight size={13} />
          </button>
        </section>
      </div>
      <div className="pw-evidence-footer">
        <ShieldCheck size={13} />
        <span>
          Parsed from saved source · revision {file.revision.slice(0, 7)}.
          Dynamic imports, aliases, and runtime calls may be unresolved.
        </span>
      </div>
    </div>
  );
}
function RelationshipColumn({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="pw-relationship-column">
      <div>
        <h3>{label}</h3>
        <span>{count}</span>
      </div>
      {children}
    </section>
  );
}
function Inspector({
  file,
  dirty,
  project,
  onOpen,
}: {
  file: ProjectFile;
  dirty: boolean;
  project: ProjectSnapshot | null;
  onOpen: (path: string, line?: number) => void;
}) {
  const analysis: FileAnalysis = file.analysis;
  const tokens = useMemo(
    () =>
      file.source
        .split("\n")
        .flatMap((line, index) => {
          const match = line.match(/(--[\w-]+)\s*:\s*([^;]+);/);
          return match
            ? [{ name: match[1], value: match[2].trim(), line: index + 1 }]
            : [];
        })
        .slice(0, 40),
    [file.source],
  );
  return (
    <div className="pw-context-scroll">
      <section className="pw-context-intro">
        <div className="pw-context-file">
          <FileGlyph path={file.path} size={19} />
          <h2>{basename(file.path)}</h2>
        </div>
        <p>{parentPath(file.path)}</p>
        <EvidenceTag />
        <div className="pw-source-facts">
          <span>
            Revision<code>{file.revision.slice(0, 7)}</code>
          </span>
          <span>
            Language<strong>{file.language}</strong>
          </span>
          <span>
            State
            <strong>
              {dirty ? "Draft differs from source" : "Saved source"}
            </strong>
          </span>
        </div>
      </section>
      <section className="pw-inspector-section">
        <h3>
          Outline<span>{analysis.symbols.length}</span>
        </h3>
        {analysis.symbols.length ? (
          analysis.symbols.map((symbol, index) => (
            <button
              className="pw-symbol-row"
              key={`${symbol.name}:${index}`}
              onClick={() => onOpen(file.path, symbol.line)}
            >
              <Braces size={12} />
              <span>
                {symbol.name}
                <small>
                  {symbol.kind}
                  {symbol.exported ? " · exported" : ""}
                </small>
              </span>
              <code>{symbol.line}</code>
            </button>
          ))
        ) : (
          <p className="pw-inspector-empty">
            {analysis.unsupported
              ? "No symbol parser for this file type."
              : "No top-level declarations found."}
          </p>
        )}
      </section>
      {tokens.length > 0 && (
        <section className="pw-inspector-section">
          <h3>
            Design tokens<span>{tokens.length}</span>
          </h3>
          {tokens.map((token, index) => (
            <button
              className="pw-token-row"
              key={`${token.name}:${index}`}
              onClick={() => onOpen(file.path, token.line)}
            >
              {/^#[\da-f]{3,8}$/i.test(token.value) ? (
                <i style={{ backgroundColor: token.value }} />
              ) : (
                <Braces size={12} />
              )}
              <span>
                <strong>{token.name}</strong>
                <code>{token.value}</code>
              </span>
            </button>
          ))}
        </section>
      )}
      <section className="pw-inspector-section">
        <h3>
          Imports<span>{analysis.imports.length}</span>
        </h3>
        {analysis.imports.map((item, index) => (
          <button
            className="pw-source-link"
            key={`${item.specifier}:${index}`}
            onClick={() =>
              onOpen(
                item.resolvedPath || file.path,
                item.resolvedPath ? undefined : item.line,
              )
            }
          >
            <FileCode2 size={13} />
            <span>
              <strong>{item.specifier}</strong>
              <small>{item.names.join(", ") || "Side-effect import"}</small>
            </span>
            <ArrowUpRight size={11} />
          </button>
        ))}
        {!analysis.imports.length && (
          <p className="pw-inspector-empty">No static imports found.</p>
        )}
      </section>
      <section className="pw-inspector-section">
        <h3>
          Direct consumers<span>{analysis.consumers.length}</span>
        </h3>
        {analysis.consumers.map((item) => (
          <button
            className="pw-source-link"
            key={`${item.path}:${item.line}`}
            onClick={() => onOpen(item.path, item.line)}
          >
            <FileCode2 size={13} />
            <span>
              <strong>{basename(item.path)}</strong>
              <small>
                {item.path}:{item.line}
              </small>
            </span>
            <ArrowUpRight size={11} />
          </button>
        ))}
        {!analysis.consumers.length && (
          <p className="pw-inspector-empty">None found in the current index.</p>
        )}
      </section>
      {analysis.requests.length > 0 && (
        <section className="pw-inspector-section">
          <h3>Request declarations</h3>
          {analysis.requests.map((request, index) => (
            <button
              className="pw-source-link"
              key={index}
              onClick={() => onOpen(file.path, request.line)}
            >
              <ArrowUpRight size={13} />
              <span>
                <strong>
                  {request.method} {request.url}
                </strong>
                <small>Source only · not observed</small>
              </span>
            </button>
          ))}
        </section>
      )}
      <section className="pw-inspector-section">
        <h3>Project targets</h3>
        {project?.targets.length ? (
          project.targets.map((target) => (
            <div className="pw-target" key={target.name}>
              <span>
                <Circle size={9} />
                {target.name}
                <small>{target.framework}</small>
              </span>
              <code>{target.command}</code>
              <small>Detected in package.json · not started</small>
            </div>
          ))
        ) : (
          <p className="pw-inspector-empty">
            No runnable package scripts detected.
          </p>
        )}
      </section>
      <div className="pw-context-boundary">
        <ShieldCheck size={13} />
        <p>
          Source analysis describes declarations and direct imports. It does not
          prove runtime behavior.
        </p>
      </div>
    </div>
  );
}
