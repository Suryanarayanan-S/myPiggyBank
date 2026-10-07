import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Field, FormError } from '../ui/Field';
import { Input } from '../ui/Input';
import { api } from '../../lib/api';

export function DangerZoneCard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const remove = useMutation({
    mutationFn: () => api.del('/auth/account', { password, confirm }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(['me'], null);
      navigate('/login', { replace: true });
    },
  });

  return (
    <Card title="Delete my account" className="border-rose-200 dark:border-rose-900">
      <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
        Permanently deletes your login. If you are the only login of this family,{' '}
        <strong>all family data</strong> — accounts, transactions, categories, members and rates —
        is deleted too. This cannot be undone.
      </p>
      <form
        className="grid gap-3 sm:grid-cols-3 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          remove.mutate();
        }}
      >
        <Field label="Your password" htmlFor="del-password">
          <Input
            id="del-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Type DELETE to confirm" htmlFor="del-confirm">
          <Input
            id="del-confirm"
            autoComplete="off"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="danger"
          disabled={confirm !== 'DELETE' || !password || remove.isPending}
        >
          {remove.isPending ? 'Deleting…' : 'Delete my account'}
        </Button>
      </form>
      <div className="mt-3">
        <FormError error={remove.error} />
      </div>
    </Card>
  );
}
