import { useState } from 'react';
import './styles.css';
export default function App() {
 const [result,setResult] = useState('Ready');
 async function ping() { setResult('Sending…'); try { const response=await fetch('/api/ping',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});setResult(response.ok?'Connected':'Failed'); } catch { setResult('Network unavailable'); } }
 return <main><h1>Connection check</h1><p>A second React fixture with no Orbit components.</p><button onClick={ping}>Send ping</button><output aria-live="polite">{result}</output></main>;
}
