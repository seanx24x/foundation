import { ProfileForm } from './components/ProfileForm';
import './styles/tokens.css';
import './styles/profile.css';

export default function App() {
  return (
    <div className="orbit-app" data-foundation-source="src/App.tsx">
      <header className="orbit-header"><a href="#profile" aria-label="Orbit home"><span className="orbit-symbol">◒</span>orbit</a><span>Personal workspace</span><div className="mini-avatar">AM</div></header>
      <main id="profile" className="settings-layout">
        <aside className="settings-nav"><span>Workspace</span><a href="#profile" aria-current="page"><span aria-hidden="true">◉</span>My profile</a><p>Keep your details up to date and make this space yours.</p></aside>
        <section className="profile-section">
          <div className="page-heading"><span className="page-kicker">Account settings</span><h1>Your profile</h1><p>The details that make you, you.</p></div>
          <label style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>Request scenario<select aria-label="Request scenario" defaultValue="success" onChange={event => sessionStorage.setItem('foundation.fixture.scenario', event.target.value)}><option value="success">Success</option><option value="slow">Slow response</option><option value="failure">HTTP failure</option><option value="offline">Network failure</option></select></label>
          <ProfileForm />
          <div className="privacy-note"><span aria-hidden="true">◇</span><p>Your information stays in this local demo. No account is created.</p></div>
        </section>
      </main>
      <footer className="orbit-footer"><span>Orbit</span><span>A little space for your best work.</span></footer>
    </div>
  );
}
