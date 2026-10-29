import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RequireAuth } from './auth/auth';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { AccountsPage } from './pages/AccountsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { BudgetPage } from './pages/BudgetPage';
import { BudgetOverviewPage } from './pages/BudgetOverviewPage';
import { CurrenciesPage } from './pages/CurrenciesPage';
import { MonthEntryPage } from './pages/MonthEntryPage';
import { ImportPage } from './pages/ImportPage';
import { WealthPage } from './pages/WealthPage';
import { GoalsPage } from './pages/GoalsPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { InvestmentsOverviewPage } from './pages/InvestmentsOverviewPage';
import { DepositsPage } from './pages/DepositsPage';
import { GoldPage } from './pages/GoldPage';
import { ReportsPage } from './pages/ReportsPage';
import { InsightsPage } from './pages/InsightsPage';
import { RecurringPage } from './pages/RecurringPage';
import { Moved, SectionLayout, type SectionTab } from './layout/SectionTabs';

/** Budget and Transactions together: the month (and Overview's period) go along between tabs. */
const SPENDING_TABS: SectionTab[] = [
  { to: '/spending', label: 'Overview', end: true },
  { to: '/spending/budget', label: 'Budget' },
  { to: '/spending/transactions', label: 'Transactions' },
  { to: '/spending/recurring', label: 'Recurring' },
  { to: '/spending/import', label: 'Import' },
];
const ANALYTICS_TABS: SectionTab[] = [{ to: '/analytics', label: 'Currencies', end: true }];
const WEALTH_TABS: SectionTab[] = [
  { to: '/wealth', label: 'Net worth & assets', end: true },
  { to: '/wealth/accounts', label: 'Accounts' },
];
const INVESTMENT_TABS: SectionTab[] = [
  { to: '/investments', label: 'Overview', end: true },
  { to: '/investments/market', label: 'Market' },
  { to: '/investments/deposits', label: 'Deposits' },
  { to: '/investments/gold', label: 'Gold' },
];
const DEPOSIT_TABS: SectionTab[] = [
  { to: '/investments/deposits', label: 'Fixed', end: true },
  { to: '/investments/deposits/recurring', label: 'Recurring' },
];
const REPORT_TABS: SectionTab[] = [
  { to: '/reports', label: 'Year report', end: true },
  { to: '/reports/insights', label: 'Insights' },
];

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route
            path="spending"
            element={
              <SectionLayout
                name="Spending"
                tabs={SPENDING_TABS}
                carry={['month', 'period', 'from', 'to']}
              />
            }
          >
            <Route index element={<BudgetOverviewPage />} />
            <Route path="budget" element={<BudgetPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="recurring" element={<RecurringPage />} />
            <Route path="import" element={<ImportPage />} />
          </Route>
          <Route path="spending/entry" element={<MonthEntryPage />} />
          <Route path="wealth" element={<SectionLayout name="Wealth" tabs={WEALTH_TABS} />}>
            <Route index element={<WealthPage />} />
            <Route path="accounts" element={<AccountsPage />} />
          </Route>
          <Route
            path="investments"
            element={<SectionLayout name="Investments" tabs={INVESTMENT_TABS} />}
          >
            <Route index element={<InvestmentsOverviewPage />} />
            <Route path="market" element={<InvestmentsPage />} />
            <Route path="deposits" element={<SectionLayout name="Deposits" tabs={DEPOSIT_TABS} />}>
              <Route index element={<DepositsPage kind="fd" />} />
              <Route path="recurring" element={<DepositsPage kind="rd" />} />
            </Route>
            <Route path="gold" element={<GoldPage />} />
          </Route>
          <Route path="goals" element={<GoalsPage />} />
          <Route
            path="analytics"
            element={<SectionLayout name="Analytics" tabs={ANALYTICS_TABS} />}
          >
            <Route index element={<CurrenciesPage />} />
          </Route>
          <Route path="reports" element={<SectionLayout name="Reports" tabs={REPORT_TABS} />}>
            <Route index element={<ReportsPage />} />
            <Route path="insights" element={<InsightsPage />} />
          </Route>
          <Route path="settings" element={<SettingsPage />} />
          {/* Pages that moved into a section keep their old addresses (bookmarks, links). */}
          <Route path="accounts" element={<Moved to="/wealth/accounts" />} />
          <Route path="recurring" element={<Moved to="/spending/recurring" />} />
          <Route path="import" element={<Moved to="/spending/import" />} />
          <Route path="budget" element={<Moved to="/spending/budget" />} />
          <Route path="budget/overview" element={<Moved to="/spending" />} />
          <Route path="budget/entry" element={<Moved to="/spending/entry" />} />
          <Route path="transactions" element={<Moved to="/spending/transactions" />} />
          <Route path="transactions/recurring" element={<Moved to="/spending/recurring" />} />
          <Route path="transactions/import" element={<Moved to="/spending/import" />} />
          <Route path="insights" element={<Moved to="/reports/insights" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
