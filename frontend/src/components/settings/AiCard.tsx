import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Card } from '../ui/Card';
import { FormError } from '../ui/Field';
import { Switch } from '../ui/Switch';
import { api } from '../../lib/api';
import { useAiStatus } from '../../lib/ai';
import type { Family } from '../../lib/types';

const n = (x: number) => x.toLocaleString('en');

export function AiCard({ family }: { family: Family }) {
  const queryClient = useQueryClient();
  const status = useAiStatus();
  const save = useMutation({
    mutationFn: (aiSuggestions: boolean) => api.put('/family', { aiSuggestions }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['ai-status'] }),
      ]),
  });
  const s = status.data;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={18} className="text-violet-600" aria-hidden /> AI suggestions
        </span>
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id="ai-categories" className="text-sm font-medium">
            Categories for bank lines
          </p>
          <p id="ai-categories-hint" className="text-xs text-slate-500">
            When you import a bank statement, lines that no saved rule or known shop can place are
            sent to Claude with their amount and your category names. Payee names go too (that is
            how a shop is recognised); IBANs, account and card
            numbers, emails, UPI IDs and phone numbers are masked first. You check every suggestion before
            importing, and the ones you keep are remembered, so a payee is asked about only once.
          </p>
        </div>
        <Switch
          on={!!s?.available && family.aiSuggestions}
          labelId="ai-categories"
          hintId="ai-categories-hint"
          disabled={!s?.available || save.isPending}
          onChange={(on) => save.mutate(on)}
        />
      </div>
      {s && !s.available && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Not set up on this server: add <code>ANTHROPIC_API_KEY=…</code> to the <code>.env</code>{' '}
          file and restart the app.
        </p>
      )}
      {s?.available && s.monthlyTokens !== null && (
        <p className="mt-3 text-xs text-slate-500">
          This month: {n(s.usedTokens)} tokens used · {n(s.monthlyTokens)} a month on this
          server · {s.model}
        </p>
      )}
      <FormError error={save.error} />
    </Card>
  );
}
