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

/** Where the money went: the month (and Overview's period) go along between tabs. */
const SPENDING_TABS: SectionTab[] = [
  { to: '/spending', label: 'Overview', end: true },
  { to: '/spending/budget', label: 'Budget' },
];
/** The money itself: transactions, the accounts they are in, and how they get there. */
const TRANSACTION_TABS: SectionTab[] = [
  { to: '/transactions', label: 'Transactions', end: true },
  { to: '/transactions/accounts', label: 'Accounts' },
  { to: '/transactions/recurring', label: 'Recurring' },
  { to: '/transactions/import', label: 'Import' },
];
const ANALYTICS_TABS: SectionTab[] = [{ to: '/analytics', label: 'Currencies', end: true }];
const WEALTH_TABS: SectionTab[] = [
  { to: '/wealth', label: 'Net worth & assets', end: true },
  { to: '/wealth/goals', label: 'Goals' },
];
const INVESTMENT_TABS: SectionTab[] = [
  { to: '/investments', label: 'Overview', end: true },
  { to: '/investments/market', label: 'Market' },
  { to: '/investments/deposits', label: 'Deposits' },
  { to: '/investments/gold', label: 'Gold' },
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
          </Route>
          <Route path="spending/entry" element={<MonthEntryPage />} />
          <Route
            path="transactions"
            element={
              <SectionLayout name="Transactions" tabs={TRANSACTION_TABS} carry={['month']} />
            }
          >
            <Route index element={<TransactionsPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="recurring" element={<RecurringPage />} />
            <Route path="import" element={<ImportPage />} />
          </Route>
          <Route path="wealth" element={<SectionLayout name="Wealth" tabs={WEALTH_TABS} />}>
            <Route index element={<WealthPage />} />
            <Route path="goals" element={<GoalsPage />} />
          </Route>
          <Route
            path="investments"
            element={<SectionLayout name="Investments" tabs={INVESTMENT_TABS} />}
          >
            <Route index element={<InvestmentsOverviewPage />} />
            <Route path="market" element={<InvestmentsPage />} />
            <Route path="deposits" element={<DepositsPage />} />
            {/* the deposits used to have a tab per kind */}
            <Route path="deposits/recurring" element={<Moved to="/investments/deposits" />} />
            <Route path="deposits/savings" element={<Moved to="/investments/deposits" />} />
            <Route path="gold" element={<GoldPage />} />
          </Route>
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
          <Route path="accounts" element={<Moved to="/transactions/accounts" />} />
          <Route path="wealth/accounts" element={<Moved to="/transactions/accounts" />} />
          <Route path="recurring" element={<Moved to="/transactions/recurring" />} />
          <Route path="import" element={<Moved to="/transactions/import" />} />
          <Route path="spending/transactions" element={<Moved to="/transactions" />} />
          <Route path="spending/recurring" element={<Moved to="/transactions/recurring" />} />
          <Route path="spending/import" element={<Moved to="/transactions/import" />} />
          <Route path="goals" element={<Moved to="/wealth/goals" />} />
          <Route path="budget" element={<Moved to="/spending/budget" />} />
          <Route path="budget/overview" element={<Moved to="/spending" />} />
          <Route path="budget/entry" element={<Moved to="/spending/entry" />} />
          <Route path="insights" element={<Moved to="/reports/insights" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
