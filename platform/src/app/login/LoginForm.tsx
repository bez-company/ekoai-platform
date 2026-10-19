'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthLayout from '@/components/AuthLayout';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push(params.get('next') || '/inbox');
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error || 'Não deu para entrar agora. Tente de novo em instantes.');
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="card w-full max-w-md space-y-5 p-8">
        <div>
          <h1 className="text-2xl font-semibold">Entrar</h1>
          <p className="mt-1 text-sm text-muted">Acesse a conta da sua empresa.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-semibold">
            Senha
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            aria-invalid={error ? true : undefined}
            className="w-full rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-sm outline-none focus:border-accent-text focus:ring-2 focus:ring-accent/30"
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Entrando' : 'Entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}
