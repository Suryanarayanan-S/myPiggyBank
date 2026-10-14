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
import { RecurringPage } from './pages/RecurringPage';

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
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="wealth" element={<WealthPage />} />
          <Route path="investments" element={<InvestmentsPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="recurring" element={<RecurringPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
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
