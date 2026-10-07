import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useMe } from '../auth/auth';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import type { Member } from '../lib/types';

export function SettingsPage() {
  const { data } = useMe();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card title="Family">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-slate-500">Name</dt>
          <dd>{data?.family.name}</dd>
          <dt className="text-slate-500">Base currency</dt>
          <dd>{data?.family.baseCurrency}</dd>
          <dt className="text-slate-500">Logged in as</dt>
          <dd className="truncate">{data?.user.email}</dd>
        </dl>
      </Card>
      <MembersCard />
    </div>
  );
}

function MembersCard() {
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ['members'], queryFn: () => api.get<Member[]>('/members') });
  const [name, setName] = useState('');
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members'] });
  const add = useMutation({
    mutationFn: () => api.post<Member>('/members', { name }),
    onSuccess: () => {
      setName('');
      return refresh();
    },
  });

  return (
    <Card title="Family members">
      <p className="mb-4 text-sm text-slate-500">
        Members let you see who spent what. Transactions without a member count as “Shared”.
      </p>
      {members.isPending ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {members.data?.map((m) => (
            <MemberRow key={m.id} member={m} onChanged={refresh} />
          ))}
        </ul>
      )}
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input
          aria-label="New member name"
          placeholder="e.g. Spouse"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={!name.trim() || add.isPending}>
          <Plus size={16} aria-hidden /> Add
        </Button>
      </form>
      <div className="mt-2">
        <FormError error={add.error} />
      </div>
    </Card>
  );
}

function MemberRow({ member, onChanged }: { member: Member; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.name);
  const rename = useMutation({
    mutationFn: () => api.put(`/members/${member.id}`, { name }),
    onSuccess: async () => {
      setEditing(false);
      await onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/members/${member.id}`),
    onSuccess: onChanged,
  });

  return (
    <li className="py-3">
      {editing ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate();
          }}
        >
          <Input
            aria-label="Member name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={!name.trim() || rename.isPending}>
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(false);
              setName(member.name);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm">
            <UserRound size={16} className="text-slate-400" aria-hidden />
            {member.name}
            {member.isUser && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500 dark:bg-slate-800">
                you
              </span>
            )}
          </span>
          <span className="flex gap-1">
            <Button
              variant="ghost"
              aria-label={`Rename ${member.name}`}
              onClick={() => setEditing(true)}
            >
              <Pencil size={16} aria-hidden />
            </Button>
            {!member.isUser && (
              <Button
                variant="ghost"
                aria-label={`Remove ${member.name}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove ${member.name}? Their transactions will become “Shared”.`,
                    )
                  )
                    remove.mutate();
                }}
              >
                <Trash2 size={16} className="text-rose-600" aria-hidden />
              </Button>
            )}
          </span>
        </div>
      )}
      <div className="mt-2 empty:hidden">
        <FormError error={rename.error ?? remove.error} />
      </div>
    </li>
  );
}
