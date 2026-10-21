import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RetroIntro } from './components/RetroIntro';
import { useLook } from './lib/theme';
import { RequireAuth } from './auth/auth';
import { AppShell } from './layout/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SettingsPage } from './pages/SettingsPage';
import { AccountsPage } from './pages/AccountsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { BudgetPage } from './pages/BudgetPage';
import { MonthEntryPage } from './pages/MonthEntryPage';
import { ImportPage } from './pages/ImportPage';
import { WealthPage } from './pages/WealthPage';
import { GoalsPage } from './pages/GoalsPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { ReportsPage } from './pages/ReportsPage';
import { InsightsPage } from './pages/InsightsPage';
import { RecurringPage } from './pages/RecurringPage';
import { Moved, SectionLayout, type SectionTab } from './layout/SectionTabs';

const TRANSACTION_TABS: SectionTab[] = [
  { to: '/transactions', label: 'All', end: true },
  { to: '/transactions/recurring', label: 'Recurring' },
  { to: '/transactions/import', label: 'Import' },
];
const WEALTH_TABS: SectionTab[] = [
  { to: '/wealth', label: 'Net worth & assets', end: true },
  { to: '/wealth/accounts', label: 'Accounts' },
];
const REPORT_TABS: SectionTab[] = [
  { to: '/reports', label: 'Year report', end: true },
  { to: '/reports/insights', label: 'Insights' },
];

export function App() {
  return (
    <BrowserRouter>
      <RetroStart />
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
          <Route path="budget" element={<BudgetPage />} />
          <Route path="budget/entry" element={<MonthEntryPage />} />
          <Route
            path="transactions"
            element={<SectionLayout name="Transactions" tabs={TRANSACTION_TABS} />}
          >
            <Route index element={<TransactionsPage />} />
            <Route path="recurring" element={<RecurringPage />} />
            <Route path="import" element={<ImportPage />} />
          </Route>
          <Route path="wealth" element={<SectionLayout name="Wealth" tabs={WEALTH_TABS} />}>
            <Route index element={<WealthPage />} />
            <Route path="accounts" element={<AccountsPage />} />
          </Route>
          <Route path="investments" element={<InvestmentsPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="reports" element={<SectionLayout name="Reports" tabs={REPORT_TABS} />}>
            <Route index element={<ReportsPage />} />
            <Route path="insights" element={<InsightsPage />} />
          </Route>
          <Route path="settings" element={<SettingsPage />} />
          {/* Pages that moved into a section keep their old addresses (bookmarks, links). */}
          <Route path="accounts" element={<Moved to="/wealth/accounts" />} />
          <Route path="recurring" element={<Moved to="/transactions/recurring" />} />
          <Route path="import" element={<Moved to="/transactions/import" />} />
          <Route path="insights" element={<Moved to="/reports/insights" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Shows the retro start screen once per visit, and whenever the retro look is switched on. */
function RetroStart() {
  const [look] = useLook();
  const [show, setShow] = useState(false);
  const previous = useRef(look);
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let seen = false;
    try {
      seen = sessionStorage.getItem('pb-intro-seen') === '1';
    } catch {
      seen = false;
    }
    const switchedOn = previous.current !== 'retro' && look === 'retro';
    previous.current = look;
    if (look === 'retro' && !reducedMotion && (!seen || switchedOn)) setShow(true);
  }, [look]);
  const start = useCallback(() => {
    setShow(false);
    try {
      sessionStorage.setItem('pb-intro-seen', '1');
    } catch {
      // ignore: the intro may show again next time
    }
  }, []);
  return show ? <RetroIntro onStart={start} /> : null;
}
