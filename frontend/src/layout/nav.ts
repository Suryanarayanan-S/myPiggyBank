import {
  ArrowLeftRight,
  ChartLine,
  Landmark,
  LayoutDashboard,
  PieChart,
  Settings,
  FileText,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

/**
 * The sections (related pages are tabs inside them: Spending → Overview, Budget; Transactions →
 * Accounts, Recurring, Import; Wealth → Goals; Investments → Market, Deposits, Gold; Reports →
 * Insights). `primary` items fill the mobile bottom bar (the daily ones); the rest open from
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
  { to: '/spending', label: 'Spending', icon: PieChart, primary: true },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, primary: true },
  { to: '/investments', label: 'Investments', icon: TrendingUp, primary: true },
  { to: '/wealth', label: 'Wealth', icon: Landmark },
  { to: '/analytics', label: 'Analytics', icon: ChartLine },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];
