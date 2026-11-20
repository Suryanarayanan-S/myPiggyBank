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
import type { Workspace } from '../lib/workspace';

/**
 * The sections of each workspace (related pages are tabs inside them: Spending → Overview, Budget;
 * Transactions → Accounts, Recurring, Import; Reports → Insights; Investments → Market, Deposits,
 * Gold; Wealth → Goals). `primary` items fill the mobile bottom bar; the rest open from “More”.
 * Settings is in both.
 */
export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  primary?: boolean;
};

export const navByWorkspace: Record<Workspace, NavItem[]> = {
  pocket: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, primary: true },
    { to: '/spending', label: 'Spending', icon: PieChart, primary: true },
    { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, primary: true },
    { to: '/reports', label: 'Reports', icon: FileText, primary: true },
    { to: '/settings', label: 'Settings', icon: Settings },
  ],
  treasure: [
    { to: '/investments', label: 'Investments', icon: TrendingUp, primary: true },
    { to: '/wealth', label: 'Wealth', icon: Landmark, primary: true },
    { to: '/analytics', label: 'Analytics', icon: ChartLine, primary: true },
    { to: '/settings', label: 'Settings', icon: Settings },
  ],
};
