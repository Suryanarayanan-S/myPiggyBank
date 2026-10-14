import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useMe } from '../auth/auth';
import { EntriesForm, GoalForm } from '../components/goals/GoalForms';
import { GoalCard } from '../components/goals/GoalCard';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FormError } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import type { Goal } from '../lib/goals';
import { useGoals, useMembers } from '../lib/queries';

export function GoalsPage() {
  const me = useMe();
  const goals = useGoals();
  const members = useMembers();
  const [dialog, setDialog] = useState<
    { kind: 'goal'; goal?: Goal } | { kind: 'entries'; id: string } | null
  >(null);
  const owner = (id: string | null) =>
    id ? (members.data?.find((m) => m.id === id)?.name ?? 'Whole family') : 'Whole family';
  const close = () => setDialog(null);
  const sections = [
    { title: null, list: goals.data?.filter((g) => g.status === 'active') ?? [] },
    { title: 'Reached', list: goals.data?.filter((g) => g.status === 'reached') ?? [] },
    { title: 'Archived', list: goals.data?.filter((g) => g.status === 'archived') ?? [] },
  ];
  // The entries dialog follows the live list, so new entries show up straight away.
  const entriesGoal =
    dialog?.kind === 'entries' ? goals.data?.find((g) => g.id === dialog.id) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
          <p className="text-sm text-slate-500">
            What you are saving for, filled by the accounts and assets you link.
          </p>
        </div>
        <Button onClick={() => setDialog({ kind: 'goal' })}>
          <Plus size={16} aria-hidden /> Add goal
        </Button>
      </div>
      <FormError error={goals.error} />
      {goals.data?.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No goals yet. Add one — a house deposit, a car, school fees — and link the Tagesgeld or
            gold that is meant for it.
          </p>
        </Card>
      )}
      {sections.map(
        (s) =>
          s.list.length > 0 && (
            <section key={s.title ?? 'active'} className="space-y-3">
              {s.title && (
                <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                  {s.title}
                </h2>
              )}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {s.list.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    owner={owner(g.memberId)}
                    onEdit={() => setDialog({ kind: 'goal', goal: g })}
                    onEntries={() => setDialog({ kind: 'entries', id: g.id })}
                  />
                ))}
              </div>
            </section>
          ),
      )}

      {dialog?.kind === 'goal' && (
        <Modal title={dialog.goal ? `Edit ${dialog.goal.name}` : 'New goal'} onClose={close}>
          <GoalForm
            goal={dialog.goal}
            defaultCurrency={me.data?.family.spendingCurrency ?? 'EUR'}
            onDone={close}
          />
        </Modal>
      )}
      {entriesGoal && (
        <Modal title={`Entries · ${entriesGoal.name}`} onClose={close}>
          <EntriesForm goal={entriesGoal} onDone={close} />
        </Modal>
      )}
    </div>
  );
}
