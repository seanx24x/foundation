import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  FileCode2,
  Loader2,
  PlugZap,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-react";
import type { ProjectFile } from "./types";
import "./assistant.css";

interface ProviderStatus {
  configured: boolean;
  provider?: string;
  model?: string;
  transport?: "local" | "remote";
  reason?: string;
  limits: { contextFiles: number; contextBytes: number; promptChars: number };
}
interface ContextSource {
  id: string;
  path: string;
  revision: string;
  source: string;
  lines: number;
}
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}
interface Turn {
  id: number;
  question: string;
  answer: string;
  state: "running" | "complete" | "stopped" | "failed";
  context: ContextSource[];
  model?: string;
  usage?: Usage;
  error?: string;
  finishReason?: string;
}
export interface AssistantPanelProps {
  projectId: string;
  files: ProjectFile[];
  activePath: string | null;
  onOpenSource: (path: string, line?: number) => void;
}

function fileSize(bytes: number) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
}
function bytesOf(source: string) {
  return new TextEncoder().encode(source).length;
}

function Answer({
  turn,
  onOpenSource,
}: {
  turn: Turn;
  onOpenSource: AssistantPanelProps["onOpenSource"];
}) {
  const chunks: ReactNode[] = [];
  const pattern = /\[(S\d+):(\d+)\]/g;
  let index = 0;
  for (const match of turn.answer.matchAll(pattern)) {
    const start = match.index;
    chunks.push(turn.answer.slice(index, start));
    const source = turn.context.find((item) => item.id === match[1]);
    const line = Number(match[2]);
    chunks.push(
      source && line >= 1 && line <= source.lines ? (
        <button
          key={start}
          className="assistant-citation"
          onClick={() => onOpenSource(source.path, line)}
          title={`${source.path}:${line} · ${source.revision.slice(0, 7)}`}
        >
          {source.path.split("/").at(-1)}:{line}
        </button>
      ) : (
        match[0]
      ),
    );
    index = start + match[0].length;
  }
  chunks.push(turn.answer.slice(index));
  return <div className="assistant-answer">{chunks}</div>;
}

export default function AssistantPanel({
  projectId,
  files,
  activePath,
  onOpenSource,
}: AssistantPanelProps) {
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [running, setRunning] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const turnId = useRef(0);
  const initializedContext = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const configRequest = useRef(0);
  const busyRef = useRef(false);

  async function refreshConfig() {
    const generation = ++configRequest.current;
    setChecking(true);
    try {
      const response = await fetch("/api/assistant/config");
      if (!response.ok)
        throw new Error(
          "Provider settings could not be loaded. Reconnect to the local runtime.",
        );
      const result = (await response.json()) as ProviderStatus;
      if (generation === configRequest.current) {
        setProvider(result);
        setConfigError(null);
      }
    } catch (reason) {
      if (generation === configRequest.current)
        setConfigError(
          reason instanceof Error
            ? reason.message
            : "Provider settings are unavailable.",
        );
    } finally {
      if (generation === configRequest.current) setChecking(false);
    }
  }

  useEffect(() => {
    void refreshConfig();
    return () => {
      configRequest.current += 1;
    };
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    turnId.current += 1;
    initializedContext.current = false;
    setSelected([]);
    setTurns([]);
    setQuestion("");
    setRunning(false);
    return () => {
      abortRef.current?.abort();
    };
  }, [projectId]);

  useEffect(() => {
    if (
      !initializedContext.current &&
      activePath &&
      files.some((file) => file.path === activePath)
    ) {
      initializedContext.current = true;
      setSelected([activePath]);
    }
  }, [projectId, activePath, files]);

  const context = selected.flatMap((path) => {
    const file = files.find((item) => item.path === path);
    return file ? [file] : [];
  });
  const contextBytes = context.reduce(
    (size, file) => size + bytesOf(file.source),
    0,
  );
  const tooLarge = contextBytes > (provider?.limits.contextBytes ?? 65536);
  const tooMany = context.length > (provider?.limits.contextFiles ?? 8);
  const promptLimit = provider?.limits.promptChars ?? 6000;

  async function ask() {
    if (
      busyRef.current ||
      !provider?.configured ||
      !question.trim() ||
      !context.length ||
      tooLarge ||
      tooMany ||
      question.length > promptLimit
    )
      return;
    const id = ++turnId.current;
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setRunning(true);
    const sources = context.map((file, i) => ({
      id: `S${i + 1}`,
      path: file.path,
      revision: file.revision,
      source: file.source,
      lines: file.source.split("\n").length,
    }));
    const prompt = question.trim();
    setQuestion("");
    setTurns((items) => [
      ...items.slice(-11),
      {
        id,
        question: prompt,
        answer: "",
        context: sources,
        state: "running",
        model: provider.model,
      },
    ]);
    const update = (patch: Partial<Turn>) =>
      setTurns((items) =>
        items.map((turn) => (turn.id === id ? { ...turn, ...patch } : turn)),
      );
    let answer = "";
    let completed = false;
    try {
      const response = await fetch("/api/assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          prompt,
          context: sources.map(({ path, revision }) => ({ path, revision })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error ||
            `The question could not be sent (${response.status}).`,
        );
      }
      if (!response.body)
        throw new Error("The assistant connection has no response stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const receive = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "delta" && typeof event.text === "string") {
          answer += event.text;
          update({ answer });
        } else if (event.type === "done") {
          completed = true;
          update({
            state: "complete",
            model: event.model,
            usage: event.usage,
            finishReason: event.finishReason,
          });
        } else if (event.type === "error")
          throw new Error(event.error || "The provider stopped unexpectedly.");
      };
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          buffer += decoder.decode();
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          receive(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      }
      if (buffer.trim()) receive(buffer);
      if (!completed)
        throw new Error("The connection ended before the answer completed.");
    } catch (reason) {
      if (controller.signal.aborted) update({ state: "stopped" });
      else
        update({
          state: "failed",
          error:
            reason instanceof Error
              ? reason.message
              : "The assistant could not answer this question.",
        });
    } finally {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        busyRef.current = false;
        setRunning(false);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
    setTurns((items) =>
      items.map((turn) =>
        turn.state === "running" ? { ...turn, state: "stopped" } : turn,
      ),
    );
  }

  return (
    <section className="project-assistant" aria-label="Source assistant">
      <div className="assistant-provider-row">
        <span
          className={`assistant-connection-dot ${provider?.configured ? "ready" : ""}`}
        />
        <div>
          <strong>
            {provider?.configured ? provider.model : "No model connected"}
          </strong>
          <span>
            {provider?.configured
              ? `${provider.transport === "local" ? "Local provider" : "Remote provider"} · ${provider.provider}`
              : "Configure a provider to ask about your source"}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh provider status"
          disabled={checking || running}
          onClick={() => void refreshConfig()}
        >
          <RefreshCw size={13} className={checking ? "spin" : ""} />
        </button>
      </div>
      <div className="assistant-scroll">
        {configError && (
          <div className="assistant-warning" role="alert">
            {configError}
          </div>
        )}
        {!provider?.configured && (
          <div className="assistant-setup">
            <PlugZap size={22} />
            <h3>Your model, your context.</h3>
            <p>
              Connect a compatible provider to get answers grounded in the files
              you choose.
            </p>
            <details>
              <summary>
                Connect a provider <ChevronDown size={12} />
              </summary>
              <p>
                Set these values in the terminal before starting Foundation. Use
                the base URL and model provided by your service.
              </p>
              <pre>
                FOUNDATION_AI_BASE_URL
                <br />
                FOUNDATION_AI_MODEL
                <br />
                FOUNDATION_AI_API_KEY
              </pre>
              <p>
                Remote providers require HTTPS and an API key. A local provider
                can use <code>http://localhost:11434/v1</code> without a key.
              </p>
              <p>
                Restart Foundation after configuring it, then refresh the
                provider status.
              </p>
              {provider?.reason && (
                <p className="assistant-setup-reason">{provider.reason}</p>
              )}
            </details>
          </div>
        )}
        <div className="assistant-context">
          <button
            className="assistant-context-toggle"
            onClick={() => setContextExpanded((value) => !value)}
            aria-expanded={contextExpanded}
          >
            <span>
              <FileCode2 size={13} />
              Shared context
            </span>
            <span>
              {context.length} {context.length === 1 ? "file" : "files"}{" "}
              <ChevronDown
                size={12}
                style={{
                  transform: contextExpanded ? undefined : "rotate(-90deg)",
                }}
              />
            </span>
          </button>
          {contextExpanded && (
            <div className="assistant-context-body">
              {!files.length ? (
                <p className="assistant-context-note">
                  Open a source file to include it here.
                </p>
              ) : (
                files.map((file) => (
                  <div className="assistant-context-file" key={file.path}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(file.path)}
                        disabled={running}
                        onChange={(event) => {
                          initializedContext.current = true;
                          setSelected((paths) =>
                            event.target.checked
                              ? [...paths, file.path]
                              : paths.filter((path) => path !== file.path),
                          );
                        }}
                      />
                      <span title={file.path}>{file.path}</span>
                    </label>
                    {selected.includes(file.path) && (
                      <details>
                        <summary>
                          Inspect saved context{" "}
                          <span>{file.revision.slice(0, 7)}</span>
                        </summary>
                        <pre>{file.source}</pre>
                      </details>
                    )}
                  </div>
                ))
              )}
              <p className="assistant-context-note">
                {fileSize(contextBytes)} selected. Only checked saved files and
                your question are sent. Each question starts fresh.
              </p>
              {(tooLarge || tooMany) && (
                <p className="assistant-warning" role="alert">
                  Choose up to 8 files totaling 64 KiB.
                </p>
              )}
            </div>
          )}
        </div>
        {!turns.length && provider?.configured && (
          <div className="assistant-empty">
            <Sparkles size={21} />
            <h3>Understand what you’re building.</h3>
            <p>
              Trace behavior, find a dependency, or work through a design change
              with your selected source.
            </p>
            {[
              "Explain this file and its dependencies.",
              "What loading and error states are missing?",
              "What should I test before changing this?",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {
                  setQuestion(suggestion);
                  composerRef.current?.focus();
                }}
              >
                <CircleHelp size={13} />
                {suggestion}
              </button>
            ))}
          </div>
        )}
        <div className="assistant-turns" aria-label="Assistant answers">
          {turns.map((turn) => {
            const unavailable = turn.context.some(
              (source) => !files.some((file) => file.path === source.path),
            );
            const stale = turn.context.some((source) => {
              const current = files.find((file) => file.path === source.path);
              return current && current.revision !== source.revision;
            });
            return (
              <article key={turn.id} className="assistant-turn">
                <p className="assistant-question">{turn.question}</p>
                <div className="assistant-answer-label">
                  <Sparkles size={13} />
                  <span>AI interpretation</span>
                  {turn.state === "running" && (
                    <Loader2 size={12} className="spin" />
                  )}
                  {turn.state === "complete" && <Check size={12} />}
                </div>
                {turn.answer ? (
                  <Answer turn={turn} onOpenSource={onOpenSource} />
                ) : turn.state === "running" ? (
                  <p className="assistant-thinking" role="status">
                    Reading your selected source…
                  </p>
                ) : null}
                {turn.error && (
                  <div className="assistant-warning" role="alert">
                    {turn.error}
                    <button
                      onClick={() => {
                        setQuestion(turn.question);
                        composerRef.current?.focus();
                      }}
                    >
                      Use question again
                    </button>
                  </div>
                )}
                {turn.state === "stopped" && (
                  <p className="assistant-context-note" role="status">
                    Stopped. The partial answer is kept.
                  </p>
                )}
                {turn.finishReason === "length" && (
                  <p className="assistant-warning">
                    The model reached its output limit. This answer may be
                    incomplete.
                  </p>
                )}
                {stale && (
                  <p className="assistant-warning">
                    Source has changed since this answer. Its context is
                    preserved below; source links open the current file.
                  </p>
                )}
                {unavailable && !stale && (
                  <p className="assistant-context-note">
                    Some source files are closed. Open them to check whether
                    this answer’s source is still current.
                  </p>
                )}
                <details className="assistant-answer-sources">
                  <summary>
                    {turn.context.length} source{" "}
                    {turn.context.length === 1 ? "snapshot" : "snapshots"}{" "}
                    <ChevronDown size={12} />
                  </summary>
                  {turn.context.map((source) => (
                    <details key={source.id}>
                      <summary>
                        <span>
                          {source.id} · {source.path}
                        </span>
                        <code>{source.revision.slice(0, 7)}</code>
                      </summary>
                      <pre>{source.source}</pre>
                    </details>
                  ))}
                </details>
                {turn.model && (
                  <div className="assistant-usage">
                    <span>{turn.model}</span>
                    {turn.usage?.total_tokens !== undefined ? (
                      <span>
                        {turn.usage.total_tokens.toLocaleString()} tokens
                      </span>
                    ) : (
                      <span>
                        {turn.state === "complete" ? "Usage not reported" : ""}
                      </span>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <textarea
          ref={composerRef}
          aria-label="Ask about selected source"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={
            provider?.configured
              ? "Ask about your selected source…"
              : "Connect a model to start asking…"
          }
          rows={3}
          disabled={!provider?.configured || running}
          maxLength={promptLimit}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void ask();
            }
          }}
        />
        <div className="assistant-composer-footer">
          <span>
            {running
              ? "Working with selected context"
              : "Source questions · no file edits"}
          </span>
          {running ? (
            <button
              className="assistant-send stop"
              type="button"
              onClick={stop}
              aria-label="Stop answer"
            >
              <Square size={12} fill="currentColor" />
              Stop
            </button>
          ) : (
            <button
              className="assistant-send"
              type="submit"
              aria-label="Ask assistant"
              disabled={
                !provider?.configured ||
                !question.trim() ||
                !context.length ||
                tooLarge ||
                tooMany
              }
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
