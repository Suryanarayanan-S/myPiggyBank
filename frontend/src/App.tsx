import { useEffect, useState } from 'react';
import { api } from './lib/api';

export function App() {
  const [status, setStatus] = useState('checking…');
  useEffect(() => {
    api
      .get<{ status: string }>('/health')
      .then((d) => setStatus(d.status))
      .catch(() => setStatus('API unreachable'));
  }, []);
  return <p className="p-8 text-lg">myPiggyBank — API: {status}</p>;
}
