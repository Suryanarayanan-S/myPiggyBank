import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { ThemeToggle } from '../components/ThemeToggle';

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <ThemeToggle className="absolute top-4 right-4" />
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Brand />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="mb-5 text-xl font-semibold">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
