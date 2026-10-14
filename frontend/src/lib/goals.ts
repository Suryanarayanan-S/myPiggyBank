export type GoalProgress = {
  pctBp: number;
  left: number;
  pace: number;
  monthsLeft: number | null;
  monthlyNeeded: number | null;
  onTrack: boolean | null;
  reached: boolean;
  overdue: boolean;
};
export type GoalLink = {
  kind: 'account' | 'asset' | 'holding';
  id: string;
  name: string;
  currency: string;
  amount: number;
};
export type Goal = {
  id: string;
  name: string;
  targetAmount: number;
  currency: string;
  targetDate: string | null;
  memberId: string | null;
  note: string | null;
  status: 'active' | 'reached' | 'archived';
  links: GoalLink[];
  entries: { id: string; date: string; amount: number; note: string | null }[];
  saved: number;
  unconverted: { currency: string; amount: number }[];
  progress: GoalProgress;
};

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

/** A word for how the goal is doing (shown next to its colour, never colour alone). */
export function goalStatus(
  p: GoalProgress,
  status: Goal['status'] = 'active',
): { label: string; tone: Tone } {
  // What the family decided wins over the numbers (money may have been spent since).
  if (status === 'reached') return { label: 'Reached', tone: 'good' };
  if (status === 'archived') return { label: 'Archived', tone: 'neutral' };
  if (p.reached) return { label: 'Reached', tone: 'good' };
  if (p.overdue) return { label: 'Past its date', tone: 'bad' };
  if (p.onTrack === null) return { label: 'No date', tone: 'neutral' };
  return p.onTrack ? { label: 'On track', tone: 'good' } : { label: 'Behind', tone: 'warn' };
}
