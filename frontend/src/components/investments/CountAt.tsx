import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../auth/auth';
import { FormError } from '../ui/Field';
import { Select } from '../ui/Select';
import { api } from '../../lib/api';
import type { Family } from '../../lib/types';

/** Whether holdings count in net worth and goals at today's value or at what was invested. */
export function CountAt() {
  const me = useMe();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (investmentsAt: Family['investmentsAt']) => api.put('/family', { investmentsAt }),
    // Net worth, goals and the wealth page all change.
    onSuccess: () => queryClient.invalidateQueries(),
  });
  const at = me.data?.family.investmentsAt ?? 'value';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="count-at" className="text-slate-500">
        Count in net worth and goals at
      </label>
      <Select
        id="count-at"
        className="!w-auto"
        value={at}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.value as Family['investmentsAt'])}
      >
        <option value="value">current value</option>
        <option value="invested">invested amount</option>
      </Select>
      <FormError error={save.error} />
    </div>
  );
}
