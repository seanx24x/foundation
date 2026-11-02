import { useMemo } from 'react';
import type { FoundationEditorTheme } from './SourceEditor';

export interface DiffViewerProps {
  before: string;
  after: string;
  theme: FoundationEditorTheme;
}

type DiffLine = { kind: 'same' | 'removed' | 'added'; text: string; oldLine?: number; newLine?: number };

// Preserve exact text and line numbers. Bound comparison work for manually edited files.
function compareLines(before: string, after: string): DiffLine[] {
  const left = before.split('\n');
  const right = after.split('\n');
  const result: DiffLine[] = [];
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) {
    result.push({ kind: 'same', text: left[prefix], oldLine: prefix + 1, newLine: prefix + 1 });
    prefix++;
  }
  let endLeft = left.length, endRight = right.length;
  while (endLeft > prefix && endRight > prefix && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--; endRight--;
  }
  const a = left.slice(prefix, endLeft), b = right.slice(prefix, endRight);
  if (a.length * b.length <= 250_000) {
    const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        result.push({ kind: 'same', text: a[i], oldLine: prefix + i + 1, newLine: prefix + j + 1 }); i++; j++;
      } else if (i < a.length && (j === b.length || lengths[i + 1][j] >= lengths[i][j + 1])) {
        result.push({ kind: 'removed', text: a[i], oldLine: prefix + i + 1 }); i++;
      } else {
        result.push({ kind: 'added', text: b[j], newLine: prefix + j + 1 }); j++;
      }
    }
  } else {
    a.forEach((text, i) => result.push({ kind: 'removed', text, oldLine: prefix + i + 1 }));
    b.forEach((text, i) => result.push({ kind: 'added', text, newLine: prefix + i + 1 }));
  }
  while (endLeft < left.length) {
    result.push({ kind: 'same', text: left[endLeft], oldLine: endLeft + 1, newLine: endRight + 1 }); endLeft++; endRight++;
  }
  return result;
}

export function DiffViewer({ before, after, theme }: DiffViewerProps) {
  const lines = useMemo(() => compareLines(before, after), [before, after]);
  const added = lines.filter(line => line.kind === 'added').length;
  const removed = lines.filter(line => line.kind === 'removed').length;
  return <div className="source-diff" role="region" aria-label="Proposed source changes" tabIndex={0} data-theme={theme}>
    <div className="diff-legend"><span className="diff-added">+{added} added</span><span className="diff-removed">−{removed} removed</span><span>Before → After</span></div>
    <div className="diff-lines">{lines.map((line, index) => <div className={`diff-line ${line.kind}`} key={index}>
      <span className="diff-line-number">{line.oldLine ?? ''}</span>
      <span className="diff-line-number">{line.newLine ?? ''}</span>
      <span className="diff-sign" aria-label={line.kind === 'same' ? 'Unchanged' : line.kind === 'added' ? 'Added' : 'Removed'}>{line.kind === 'same' ? ' ' : line.kind === 'added' ? '+' : '−'}</span>
      <code>{line.text || ' '}</code>
    </div>)}</div>
  </div>;
}
export default DiffViewer;
