import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import './style.css';

type Status = 'idle' | 'loading' | 'success' | 'error' | 'offline';
export default function App() {
  const [name, setName] = useState('Alex Morgan');
  const [status, setStatus] = useState<Status>('idle');
  const [fixture, setFixture] = useState('Manual');
  const state = useRef<Status>('idle'), pending = useRef<AbortController | null>(null);
  const publish = (next: Status) => { state.current = next; flushSync(() => setStatus(next)); };
  const save = async (outcome: 'success' | 'error' | 'offline', signal?: AbortSignal) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once:true });
    if (signal?.aborted) controller.abort();
    publish('loading');
    try {
      const response = await fetch('/api/fixture/' + outcome, { method:'POST', signal:controller.signal });
      if (!controller.signal.aborted) publish(response.ok ? 'success' : 'error');
    } catch (error) {
      if (!controller.signal.aborted) publish('offline');
      else throw error;
    } finally { signal?.removeEventListener('abort', abort); if (pending.current === controller) pending.current = null; }
  };
  useEffect(() => {
    let disposed = false, unregister: (() => void) | undefined;
    // Development-only: the production bundle never imports the replay API.
    if (import.meta.env.DEV) void import('virtual:foundation/scenarios').then(({ registerFoundationScenarios }) => {
      if (disposed) return;
      unregister = registerFoundationScenarios({ version:1, recipes: (['idle','loading','success','error','offline'] as const).map(outcome => ({
        id:'profile-' + outcome, title:({idle:'Idle profile', loading:'Loading profile', success:'Successful save', error:'Server error', offline:'Network unavailable'})[outcome],
        route:'/', fixture:{id:'alex-profile-v1', label:'Alex Morgan · local fixture'},
        prepare:async ({signal,conditions}: any) => {
          if (signal.aborted) throw new Error('Stopped');
          pending.current?.abort(); pending.current = null;
          document.documentElement.dataset.theme = conditions.theme;
          document.documentElement.dataset.motion = conditions.motion;
          flushSync(() => { setName('Alex Morgan'); setFixture(outcome); }); publish('idle');
        },
        steps:[{id:'show-' + outcome, title:outcome === 'idle' ? 'Keep the reset profile ready' : outcome === 'loading' ? 'Hold the loading fixture' : 'Save with a local ' + outcome + ' response',
          run:async ({signal}: any) => {
            if (signal.aborted) throw new Error('Stopped');
            if (outcome === 'loading') publish('loading');
            else if (outcome !== 'idle') await save(outcome, signal);
            if (state.current !== outcome) throw new Error('Unexpected fixture state');
          }}],
      })) });
    });
    return () => { disposed = true; unregister?.(); pending.current?.abort(); };
  }, []);
  const label = {idle:'Ready to save', loading:'Saving your profile…', success:'Profile saved', error:'Couldn’t save. Try again.', offline:'Connection unavailable. Your changes are here.'}[status];
  return <main className="fixture-shell" data-fixture-state={status}>
    <header><span className="fixture-mark" aria-hidden="true">◒</span><strong>Orbit</strong><span className="fixture-tag">Local replay fixture</span></header>
    <section className="profile-card"><span className="eyebrow">Personal workspace</span><h1>Your profile</h1><p>A small space for your best work.</p>
      <label htmlFor="profile-name">Display name</label><input id="profile-name" value={name} onChange={event=>setName(event.target.value)} />
      <div className="save-row"><button className="save-button" disabled={status === 'loading'} onClick={()=>void save('success').catch(()=>{})}>{status === 'loading' ? 'Saving…' : 'Save changes'}</button><span role="status" data-outcome={status}>{label}</span></div>
    </section><footer><span>Fixture: {fixture}</span><span>Sample data · no account created</span></footer>
  </main>;
}
