import { useState, type FormEvent } from 'react';
import { SaveButton, type SaveState } from './SaveButton';
import { saveProfile, type Profile } from '../api/profile';

const initial: Profile = {
  name: 'Alex Morgan',
  email: 'alex@orbit.design',
  role: 'Design engineer',
  bio: 'Making thoughtful things for the web.',
};

export function ProfileForm() {
  const [profile, setProfile] = useState(initial);
  const [state, setState] = useState<SaveState>('idle');
  const [message, setMessage] = useState('');
  const [simulateError, setSimulateError] = useState(false);

  function update(field: keyof Profile, value: string) {
    setProfile(current => ({ ...current, [field]: value }));
    setState('idle');
    setMessage('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('saving');
    setMessage('');
    try {
      await saveProfile(profile, simulateError);
      setState('saved');
      setMessage('Your profile is up to date.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <form onSubmit={submit} data-foundation-source="src/components/ProfileForm.tsx">
      <div className="avatar-row">
        <div className="avatar" aria-hidden="true">AM</div>
        <div><strong>Alex Morgan</strong><p>Your personal workspace</p></div>
        <span className="plan-label">Pro plan</span>
      </div>
      <div className="form-fields">
        <label>Full name<input required value={profile.name} onChange={e => update('name', e.target.value)} autoComplete="name" /></label>
        <label>Email address<input required type="email" value={profile.email} onChange={e => update('email', e.target.value)} autoComplete="email" /></label>
        <label>Role<input value={profile.role} onChange={e => update('role', e.target.value)} /></label>
        <label className="full-width">About you<textarea rows={3} value={profile.bio} onChange={e => update('bio', e.target.value)} /><small>A little about what you do. This appears on your profile.</small></label>
      </div>
      <div className="form-footer">
        <span className={`save-feedback ${state}`} role="status" aria-live="polite">{message || 'Changes are saved to the local demo service.'}</span>
        <SaveButton state={state} />
      </div>
      <label className="scenario-control"><input type="checkbox" checked={simulateError} onChange={e => setSimulateError(e.target.checked)} />Simulate a failed request</label>
    </form>
  );
}
