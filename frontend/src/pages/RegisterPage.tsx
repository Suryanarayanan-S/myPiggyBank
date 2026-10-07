import { useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router';
import { useMe } from '../auth/auth';
import { Button } from '../components/ui/Button';
import { Field, FormError } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { AuthLayout } from '../layout/AuthLayout';
import { api } from '../lib/api';

export function RegisterPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', familyName: '' });
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const register = useMutation({
    mutationFn: () =>
      api.post('/auth/register', {
        name: form.name,
        email: form.email,
        password: form.password,
        ...(form.familyName.trim() ? { familyName: form.familyName } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
  });

  if (me.data) return <Navigate to="/" replace />;

  return (
    <AuthLayout title="Create your account">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate();
        }}
      >
        <Field label="Your name" htmlFor="name">
          <Input id="name" autoComplete="name" required value={form.name} onChange={set('name')} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
          />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={form.password}
            onChange={set('password')}
          />
        </Field>
        <Field label="Family name (optional)" htmlFor="familyName">
          <Input
            id="familyName"
            placeholder="e.g. Soundararajan"
            value={form.familyName}
            onChange={set('familyName')}
          />
        </Field>
        <FormError error={register.error} />
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-5 text-center text-sm text-slate-500">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
