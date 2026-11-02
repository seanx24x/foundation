import test from "node:test";
import assert from "node:assert/strict";
import { createChangeProposal, listDesignTokens, createTokenProposal, validTokenValue } from "../server/project/proposals.mjs";

const file = { path: "src/Button.tsx", revision: "before-r1", source: 'export function Button() {\n  return <button className="save">Save</button>;\n}\n' };
const other = { path: "src/consumer.ts", revision: "consumer-r1", source: "export const uses = 'Button';\n" };
const data = edits => ({ title: "Clarify the action", summary: "Update the button label only.", edits, verification: ["Check the button label in the preview."] });
const edit = { path: file.path, find: ">Save</button>", replace: ">Save changes</button>" };
const create = value => createChangeProposal({ raw: typeof value === "string" ? value : JSON.stringify(value), files: [file, other], projectId: "orbit" });

test("AI proposal captures one exact source change and all disclosed context without mutating input", () => {
  const p = create(data([edit]));
  assert.equal(p.path, file.path);
  assert.equal(p.before, file.source);
  assert.equal(p.after, file.source.replace(edit.find, edit.replace));
  assert.equal(p.baseRevision, "before-r1");
  assert.equal(p.status, "proposed");
  assert.equal(p.origin, "ai");
  assert.deepEqual(p.context, [{ path: file.path, revision: file.revision }, { path: other.path, revision: other.revision }]);
  assert.equal(file.source.includes("Save changes"), false);
  assert.match(p.id, /^[\da-f-]{36}$/);
});

test("multiple non-overlapping edits use original offsets even when replacements change length", () => {
  const p = create(data([
    { path: file.path, find: 'className="save"', replace: 'className="save-button" aria-label="Save changes"' },
    edit,
  ]));
  assert.match(p.after, /className="save-button" aria-label="Save changes">Save changes<\/button>/);
});

test("proposal cannot escape context or edit multiple files", () => {
  for (const path of ["src/missing.ts", "../outside.ts", "/tmp/outside.ts", "src\\outside.ts"])
    assert.throws(() => create(data([{ ...edit, path }])), /selected source file/);
  assert.throws(() => create(data([edit, { path: other.path, find: "Button", replace: "Other" }])), /one existing source file/);
});

test("missing, ambiguous, overlapping and unchanged anchors are rejected", () => {
  assert.throws(() => create(data([{ ...edit, find: "not present" }])), { code: "proposal-anchor-missing" });
  assert.throws(() => create(data([{ ...edit, find: "button" }])), { code: "proposal-anchor-ambiguous" });
  assert.throws(() => create(data([edit, { ...edit, find: "Save</button>" }])), { code: "proposal-overlap" });
  assert.throws(() => create(data([{ ...edit, replace: edit.find }])), { code: "proposal-no-change" });
  assert.throws(() => create(data([{ ...edit, find: "" }])), /non-empty source anchor/);
});

test("invalid and incomplete model output never becomes an applicable proposal", () => {
  for (const raw of ["```json\n{}\n```", '{"title":"unfinished"', "[]", JSON.stringify({ ...data([edit]), command: "run something" }), JSON.stringify({ ...data([edit]), edits: [] }), JSON.stringify({ ...data([edit]), verification: "already passed" }), JSON.stringify(data([{ ...edit, replace: "\0" }])), "x".repeat(65537)])
    assert.throws(() => create(raw));
});

test("theme-specific CSS token declarations retain their own selector, value, and occurrence", () => {
  const css = { path: "src/tokens.css", revision: "css-r1", source: ":root {\n  --ink: #123456;\n  --space: 24px;\n}\n:root[data-theme='dark'] { --ink: #ffffff; }\n@media (max-width: 600px) { :root { --space: 18px; } }\n" };
  const tokens = listDesignTokens([css, file]);
  assert.equal(tokens.length, 4);
  assert.deepEqual(tokens.map(t => [t.name, t.value, t.occurrence, t.scope]), [
    ["--ink", "#123456", 0, ":root"], ["--space", "24px", 0, ":root"],
    ["--ink", "#ffffff", 1, ":root[data-theme='dark']"], ["--space", "18px", 1, "@media (max-width: 600px) / :root"],
  ]);
  const p = createTokenProposal({ file: css, name: "--ink", occurrence: 1, value: "#ddddee", projectId: "orbit" });
  assert.equal(p.after, css.source.replace("#ffffff", "#ddddee"));
  assert.equal(p.origin, "design");
  assert.equal(p.baseRevision, css.revision);
  assert.deepEqual(p.context, [{ path: css.path, revision: css.revision }]);
  assert.match(p.summary, /All consumers/);
});

test("CSS scanner ignores comments, strings, and non-declaration contexts while preserving unicode offsets", () => {
  const css = { path: "src/tokens.css", revision: "css-r2", source: '/* 🎨 --fake: 1px; */\n@media screen { --invalid: 8px; .card { content: "--string: 2px; { }"; --size /* : comment */ : 12px /* retain */; } }\n' };
  const [token, ...rest] = listDesignTokens([css]);
  assert.equal(rest.length, 0);
  assert.equal(token.name, "--size");
  assert.equal(token.value, "12px");
  assert.equal(token.scope, "@media screen / .card");
  const p = createTokenProposal({ file: css, name: "--size", occurrence: 0, value: "16px", projectId: "orbit" });
  assert.equal(p.after, css.source.replace("12px", "16px"));
});

test("token changes require an explicit occurrence and reject injection, references and stale declarations", () => {
  const css = { path: "src/tokens.css", revision: "css-r1", source: ":root { --space: 24px; }" };
  for (const value of ["url(https://example.com)", "var(--other)", "red; color: blue", "/*x*/red", "red}", "red\0", " calc(1px) ", "1px\n;display:none", "rgb(,,)", "rgb(1 / 2)", "hsl(1 2 3)", "rgba(1,2,3,4,5)"])
    assert.throws(() => createTokenProposal({ file: css, name: "--space", occurrence: 0, value, projectId: "orbit" }), { code: "invalid-token-value" });
  assert.throws(() => createTokenProposal({ file: css, name: "--space", value: "12px", projectId: "orbit" }), { code: "token-ambiguous" });
  assert.throws(() => createTokenProposal({ file: css, name: "--space", occurrence: 1, value: "12px", projectId: "orbit" }), { code: "token-not-found" });
  assert.throws(() => createTokenProposal({ file: css, name: "--space", occurrence: 0, value: "24px", projectId: "orbit" }), { code: "proposal-no-change" });
  for (const value of ["#123", "#abcdef", "#abcd", "#11223344", "24px", "1.5rem", "-.25em", "50%", "0", "rgb(12, 24, 36)", "hsl(210 40% 50%)", "transparent"])
    assert.equal(validTokenValue(value), true, value);
});
