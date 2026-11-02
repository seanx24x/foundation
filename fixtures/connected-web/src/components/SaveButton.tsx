export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function SaveButton({ state }: { state: SaveState }) {
  const busy = state === 'saving';
  return (
    <button
      className="save-button"
      type="submit"
      disabled={busy}
      aria-busy={busy}
      data-foundation-source="src/components/SaveButton.tsx"
    >
      {busy ? 'Saving…' : state === 'saved' ? 'Changes saved' : 'Save changes'}
      <span aria-hidden="true">{state === 'saved' ? '✓' : '↗'}</span>
    </button>
  );
}
