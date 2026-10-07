import { useMe } from '../auth/auth';
import { Card } from '../components/ui/Card';

export function DashboardPage() {
  const { data } = useMe();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome, {data?.user.name}</h1>
      <Card title="Getting started">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Your dashboard will show income, expenses, savings and net worth once accounts and
          transactions are added. Start by adding your family members under Settings.
        </p>
      </Card>
    </div>
  );
}
