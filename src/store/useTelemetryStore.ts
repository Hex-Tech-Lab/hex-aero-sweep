"use client";

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type LogSource = 'OPENROUTER' | 'DUFFEL' | 'SYSTEM';
export type LogType = 'REQUEST' | 'RESPONSE' | 'ERROR' | 'INFO';

export interface LogEntry {
  id: string;
  timestamp: string;
  source: LogSource;
  type: LogType;
  message?: string;
  payload?: any;
  latency?: number;
  rawResponse?: string;
}

interface TelemetryState {
  logs: LogEntry[];
  isVisible: boolean;
  isExpanded: boolean;
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  toggleVisibility: () => void;
  setVisibility: (visible: boolean) => void;
  toggleExpanded: () => void;
}

export const useTelemetryStore = create<TelemetryState>()(
  persist(
    (set) => ({
      logs: [],
      isVisible: true,
      isExpanded: false,

      addLog: (log) => {
        const entry: LogEntry = {
          ...log,
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
        };

        set((state) => ({
          logs: [...state.logs, entry],
        }));

        console.log(`[TELEMETRY] ${entry.source} ${entry.type}:`, entry.message || '', entry.payload);
      },

      clearLogs: () => set({ logs: [] }),

      toggleVisibility: () => set((state) => ({ isVisible: !state.isVisible })),

      setVisibility: (visible) => set({ isVisible: visible }),

      toggleExpanded: () => set((state) => ({ isExpanded: !state.isExpanded })),
    }),
    {
      name: 'aerosweep-telemetry-store',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        isVisible: state.isVisible,
        isExpanded: state.isExpanded,
      }),
    }
  )
);
