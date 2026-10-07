import {
  ArrowLeftRight,
  Landmark,
  LayoutDashboard,
  PieChart,
  Repeat,
  Settings,
  Upload,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/** `primary` items fill the mobile bottom bar; the rest open from “More”. */
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
  { to: '/accounts', label: 'Accounts', icon: Wallet },
  { to: '/wealth', label: 'Wealth', icon: Landmark, primary: true },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/import', label: 'Import', icon: Upload },
  { to: '/settings', label: 'Settings', icon: Settings },
];
