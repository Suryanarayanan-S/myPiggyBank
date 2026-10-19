import { useMe } from '../auth/auth';
import { CategoriesCard } from '../components/settings/CategoriesCard';
import { DangerZoneCard } from '../components/settings/DangerZoneCard';
import { AppearanceCard } from '../components/settings/AppearanceCard';
import { ExtrasCard } from '../components/settings/ExtrasCard';
import { FamilyCard } from '../components/settings/FamilyCard';
import { RatesCard } from '../components/settings/RatesCard';

export function SettingsPage() {
  const { data } = useMe();
  if (!data) return null;
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <FamilyCard
          key={data.family.id + data.family.name}
          family={data.family}
          email={data.user.email}
        />
        <ExtrasCard family={data.family} />
        <AppearanceCard />
      </div>
      <CategoriesCard />
      <RatesCard family={data.family} />
      <DangerZoneCard />
    </div>
  );
}
