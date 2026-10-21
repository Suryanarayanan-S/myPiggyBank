import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  PieChart,
  Settings,
  FileText,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

/**
 * The sections (related pages are tabs inside them: Transactions → Recurring, Import; Wealth →
 * Accounts; Reports → Insights). `primary` items fill the mobile bottom bar; the rest open from
 * “More”.
 */
export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  primary?: boolean;
};

export const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, primary: true },
  { to: '/budget', label: 'Budget', icon: PieChart, primary: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, primary: true },
  { to: '/wealth', label: 'Wealth', icon: Landmark, primary: true },
  { to: '/investments', label: 'Investments', icon: TrendingUp },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];
