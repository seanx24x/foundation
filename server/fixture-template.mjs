/** Exact, reviewed fixture sources. This is deliberately not an AI provider. */
export const SOURCE_PATH = 'fixtures/web/src/SaveButton.tsx';

export const BASELINE_SOURCE = `type SaveButtonProps = {
  onSave: () => Promise<void>;
};

export function SaveButton({ onSave }: SaveButtonProps) {
  return (
    <div className="fixture-save-control">
      <button
        type="button"
        className="fixture-save"
        aria-label="Save changes"
        data-foundation-source="fixtures/web/src/SaveButton.tsx"
        data-foundation-entity="save-button"
        onClick={() => { void onSave().catch(() => undefined); }}
      >
        Save changes
      </button>
    </div>
  );
}
`;

export const IMPROVED_SOURCE = `import { useState } from 'react';

type SaveButtonProps = {
  onSave: () => Promise<void>;
};

export function SaveButton({ onSave }: SaveButtonProps) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');

  async function handleSave() {
    if (status === 'pending') return;
    setStatus('pending');
    try {
      await onSave();
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="fixture-save-control">
      <button
        type="button"
        className="fixture-save"
        aria-label="Save changes"
        data-foundation-source="fixtures/web/src/SaveButton.tsx"
        data-foundation-entity="save-button"
        data-state={status}
        disabled={status === 'pending'}
        onClick={() => { void handleSave(); }}
      >
        {status === 'pending' ? 'Saving…' : status === 'success' ? '✓ Saved' : status === 'error' ? 'Try again' : 'Save changes'}
      </button>
      <p className="fixture-save-status" role="status" aria-live="polite">
        {status === 'error' ? 'We couldn’t save your changes. Try again.' : status === 'success' ? 'All changes saved.' : status === 'pending' ? 'Saving your changes.' : ''}
      </p>
    </div>
  );
}
`;
