"use client";

import { create } from 'zustand';

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
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  toggleVisibility: () => void;
  setVisibility: (visible: boolean) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  logs: [],
  isVisible: true,

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
}));
