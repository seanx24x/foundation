import { useCallback, useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import TypeScriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";

export type FoundationEditorTheme = "dark" | "light";

export interface SourceEditorProps {
  source: string;
  path: string;
  theme: FoundationEditorTheme;
  onChange: (source: string) => void;
  onSave: () => void;
  readOnly?: boolean;
  revealLine?: number;
  revealKey?: number;
}

let configured = false;

/** Keep Monaco and its language workers local, including when working offline. */
export function configureFoundationMonaco() {
  if (configured) return;
  configured = true;

  const workerHost = globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: (moduleId: string, label: string) => Worker;
    };
  };
  workerHost.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      if (label === "typescript" || label === "javascript")
        return new TypeScriptWorker();
      if (label === "json") return new JsonWorker();
      if (label === "css" || label === "scss" || label === "less")
        return new CssWorker();
      if (label === "html" || label === "handlebars" || label === "razor")
        return new HtmlWorker();
      return new EditorWorker();
    },
  };

  loader.config({ monaco });

  monaco.editor.defineTheme("foundation-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "C7CDD8" },
      { token: "comment", foreground: "717C8E", fontStyle: "italic" },
      { token: "keyword", foreground: "B5A1E3" },
      { token: "string", foreground: "A5C7AE" },
      { token: "number", foreground: "D9B98F" },
      { token: "type.identifier", foreground: "92BDD4" },
      { token: "identifier", foreground: "CDD3DD" },
      { token: "delimiter", foreground: "919AAA" },
      { token: "tag", foreground: "93B9DF" },
      { token: "attribute.name", foreground: "B2A7DC" },
      { token: "attribute.value", foreground: "A5C7AE" },
    ],
    colors: {
      "editor.background": "#17191E",
      "editor.foreground": "#C7CDD8",
      "editorLineNumber.foreground": "#565E6D",
      "editorLineNumber.activeForeground": "#A9B2C3",
      "editorCursor.foreground": "#BBCBFF",
      "editor.selectionBackground": "#45567B66",
      "editor.inactiveSelectionBackground": "#45567B33",
      "editor.lineHighlightBackground": "#FFFFFF03",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background1": "#FFFFFF09",
      "editorIndentGuide.activeBackground1": "#FFFFFF1C",
      "editorWidget.background": "#20232A",
      "editorWidget.border": "#373D49",
      "editorGutter.background": "#17191E",
      "editorOverviewRuler.border": "#00000000",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#8993A522",
      "scrollbarSlider.hoverBackground": "#8993A542",
      "scrollbarSlider.activeBackground": "#8993A560",
      "diffEditor.insertedTextBackground": "#6CA68226",
      "diffEditor.removedTextBackground": "#B16C7526",
      "diffEditor.insertedLineBackground": "#6CA6820D",
      "diffEditor.removedLineBackground": "#B16C750D",
    },
  });

  monaco.editor.defineTheme("foundation-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "374151" },
      { token: "comment", foreground: "7D8795", fontStyle: "italic" },
      { token: "keyword", foreground: "8054AD" },
      { token: "string", foreground: "3A7C5F" },
      { token: "number", foreground: "95682F" },
      { token: "type.identifier", foreground: "2D7893" },
      { token: "identifier", foreground: "374151" },
      { token: "delimiter", foreground: "7B8493" },
      { token: "tag", foreground: "3D6DAD" },
      { token: "attribute.name", foreground: "8054AD" },
      { token: "attribute.value", foreground: "3A7C5F" },
    ],
    colors: {
      "editor.background": "#FFFFFF",
      "editor.foreground": "#374151",
      "editorLineNumber.foreground": "#B0B6C1",
      "editorLineNumber.activeForeground": "#626D80",
      "editorCursor.foreground": "#5972BF",
      "editor.selectionBackground": "#B8C9F566",
      "editor.inactiveSelectionBackground": "#B8C9F533",
      "editor.lineHighlightBackground": "#36476803",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background1": "#1D29390B",
      "editorIndentGuide.activeBackground1": "#1D293927",
      "editorWidget.background": "#FFFFFF",
      "editorWidget.border": "#DFE3EA",
      "editorGutter.background": "#FFFFFF",
      "editorOverviewRuler.border": "#00000000",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#8993A522",
      "scrollbarSlider.hoverBackground": "#8993A542",
      "scrollbarSlider.activeBackground": "#8993A560",
      "diffEditor.insertedTextBackground": "#6CA6822A",
      "diffEditor.removedTextBackground": "#B16C7526",
      "diffEditor.insertedLineBackground": "#6CA6820B",
      "diffEditor.removedLineBackground": "#B16C750B",
    },
  });
}

configureFoundationMonaco();

export const foundationEditorOptions: monaco.editor.IStandaloneEditorConstructionOptions =
  {
    automaticLayout: true,
    fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    lineHeight: 21,
    fontLigatures: false,
    minimap: { enabled: false },
    lineNumbers: "on",
    lineNumbersMinChars: 3,
    wordWrap: "on",
    padding: { top: 14, bottom: 18 },
    scrollBeyondLastLine: false,
    smoothScrolling: false,
    cursorSmoothCaretAnimation: "off",
    bracketPairColorization: { enabled: true },
    guides: { indentation: true, bracketPairs: false },
    contextmenu: true,
    renderLineHighlight: "line",
    renderWhitespace: "selection",
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    overviewRulerLanes: 0,
    glyphMargin: false,
    folding: true,
    foldingHighlight: false,
    showFoldingControls: "mouseover",
    fixedOverflowWidgets: true,
    tabSize: 2,
    insertSpaces: true,
    accessibilitySupport: "auto",
    // Use the established textarea input path across embedded browser hosts.
    editContext: false,
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
    },
  };

const languageByExtension: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  md: "markdown",
  mdx: "mdx",
  swift: "swift",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
};

function languageForPath(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase() || "";
  // Unregistered grammars (including TOML, Sass, Vue, and Svelte) stay editable
  // without misleading TypeScript diagnostics.
  return languageByExtension[extension] || "plaintext";
}

export function SourceEditor({
  source,
  path,
  theme,
  onChange,
  onSave,
  readOnly = false,
  revealLine,
  revealKey,
}: SourceEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const targetLine = useRef(revealLine);
  targetLine.current = revealLine;
  useEffect(() => {
    if (revealLine && editorRef.current) {
      editorRef.current.revealLineInCenter(revealLine);
      editorRef.current.setPosition({ lineNumber: revealLine, column: 1 });
      editorRef.current.focus();
    }
  }, [path, revealLine, revealKey]);
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);

  const handleMount = useCallback<OnMount>((editor, api) => {
    editorRef.current = editor;
    if (targetLine.current) {
      editor.revealLineInCenter(targetLine.current);
      editor.setPosition({ lineNumber: targetLine.current, column: 1 });
      editor.focus();
    }
    const saveAction = editor.addAction({
      id: "foundation.save",
      label: "Save in Foundation",
      keybindings: [api.KeyMod.CtrlCmd | api.KeyCode.KeyS],
      run: () => saveRef.current(),
    });
    editor.onDidDispose(() => {
      saveAction.dispose();
      editorRef.current = null;
    });
  }, []);

  return (
    <Editor
      height="100%"
      width="100%"
      path={path}
      language={languageForPath(path)}
      value={source}
      theme={`foundation-${theme}`}
      options={{
        ...foundationEditorOptions,
        readOnly,
        ariaLabel: `Source editor: ${path}`,
      }}
      onMount={handleMount}
      onChange={(value) => onChange(value ?? "")}
      loading={
        <span
          role="status"
          style={{ color: "var(--text-muted, #8892a3)", fontSize: 12 }}
        >
          Opening source…
        </span>
      }
    />
  );
}

export default SourceEditor;
