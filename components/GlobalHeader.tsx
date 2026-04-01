'use client';

import { useRouter } from 'next/navigation';
import { Plane } from 'lucide-react';
import { useTicketStore } from '@/src/store/useTicketStore';

export function GlobalHeader() {
  const router = useRouter();
  const resetStore = useTicketStore((state) => state.resetStore);

  const handleLogoClick = () => {
    resetStore();
    router.push('/');
  };

  return (
    <header className="border-b border-slate-800 bg-slate-950/95 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <button
          onClick={handleLogoClick}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
        >
          <div className="relative">
            <Plane className="w-6 h-6 text-cyan-400" />
            <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              AEROSWEEP <span className="text-cyan-400">v4.0</span>
            </h1>
            <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">
              Aviation Pricing Intelligence Platform
            </p>
          </div>
        </button>
      </div>
    </header>
  );
}
