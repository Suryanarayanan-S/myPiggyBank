import { LayoutDashboard, Settings, type LucideIcon } from 'lucide-react';

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

/** Later milestones add Transactions, Budget, Accounts, Net worth, Import here. */
export const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/settings', label: 'Settings', icon: Settings },
];
