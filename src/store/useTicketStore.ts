import { create } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';

export type TicketData = {
  pnr: string;
  primaryPassengerLastName: string;
  passengers: string[];
  fareClass: string;
  baseCost: number;
  issueDate: Date | null;
  expirationDate: Date | null;
  departureDate: Date | null; // Original departure date for rebooking detection
  passengerBreakdown?: {
    adults?: number;
    children?: number;
    infants?: number;
    passengerTypeSource?: string;
    manualOverride?: boolean;
  };
  rules: {
    validity: string;
    luggage: string;
    cancellation: string;
  };
};

export type ConfigData = {
  searchWindowStart: Date | null;
  searchWindowEnd: Date | null;
  minNights: number;
  maxNights: number;
  priceTolerance: number;
  maxApiCalls: number;
  // Rebooking mode preferences
  directFlightOnly: boolean;
  timePreference: 'any' | 'morning' | 'evening';
  outboundTimePreference: 'any' | 'morning' | 'afternoon' | 'evening';
  inboundTimePreference: 'any' | 'morning' | 'afternoon' | 'evening';
};

export type ExecutionMetrics = {
  totalScanned: number;
  candidatesFound: number;
  outOfRange: number;
  status: 'idle' | 'running' | 'completed' | 'error' | 'aborted';
  progress?: string;
};

export type TerminalLog = {
  id: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: Date;
};

export type FlightResult = {
  id: string;
  carrier: string;
  departureDate: string;
  returnDate: string;
  nights: number;
  price: number;
  yieldDelta: number;
  status: string;
  fareBrand?: string;
  metadata: Record<string, any>;
};

type TicketStore = {
  ticket: TicketData;
  config: ConfigData;
  metrics: ExecutionMetrics;
  logs: TerminalLog[];
  flightResults: FlightResult[];
  currentStep: number;
  sweepExecutionId: string | null;

  setTicket: (ticket: Partial<TicketData>) => void;
  setConfig: (config: Partial<ConfigData>) => void;
  setMetrics: (metrics: Partial<ExecutionMetrics>) => void;
  addLog: (log: Omit<TerminalLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  addFlightResult: (flight: FlightResult) => void;
  clearFlightResults: () => void;
  setCurrentStep: (step: number) => void;
  setSweepExecutionId: (id: string | null) => void;
  resetStore: () => void;
  isTicketExpired: () => boolean;
  isTicketValid: () => boolean;
  isConfigValid: () => boolean;
  isRebookingMode: () => boolean;
};

const initialTicket: TicketData = {
  pnr: '',
  primaryPassengerLastName: '',
  passengers: [],
  fareClass: 'ECONOMY',
  baseCost: 0,
  issueDate: null,
  expirationDate: null,
  departureDate: null,
  rules: {
    validity: '',
    luggage: '',
    cancellation: '',
  },
};

const initialConfig: ConfigData = {
  searchWindowStart: null,
  searchWindowEnd: null,
  minNights: 3,
  maxNights: 14,
  priceTolerance: 50,
  maxApiCalls: 100,
  // Rebooking mode preferences
  directFlightOnly: false,
  timePreference: 'any',
  outboundTimePreference: 'any',
  inboundTimePreference: 'any',
};

const initialMetrics: ExecutionMetrics = {
  totalScanned: 0,
  candidatesFound: 0,
  outOfRange: 0,
  status: 'idle',
  progress: undefined,
};

const MAX_LOGS = 500;

export const useTicketStore = create<TicketStore>()(
  persist(
    (set, get) => ({
  ticket: initialTicket,
  config: initialConfig,
  metrics: initialMetrics,
  logs: [],
  flightResults: [],
  currentStep: 1,
  sweepExecutionId: null,

  setTicket: (ticket) =>
    set((state) => ({
      ticket: { ...state.ticket, ...ticket },
    })),

  setConfig: (config) =>
    set((state) => ({
      config: { ...state.config, ...config },
    })),

  setMetrics: (metrics) =>
    set((state) => ({
      metrics: { ...state.metrics, ...metrics },
    })),

  addLog: (log) =>
    set((state) => {
      const newLog: TerminalLog = {
        ...log,
        id: `${Date.now()}-${Math.random()}`,
        timestamp: new Date(),
      };

      const updatedLogs = [...state.logs, newLog];

      if (updatedLogs.length > MAX_LOGS) {
        return { logs: updatedLogs.slice(-MAX_LOGS) };
      }

      return { logs: updatedLogs };
    }),

  clearLogs: () => set({ logs: [] }),

  addFlightResult: (flight) =>
    set((state) => ({
      flightResults: [...state.flightResults, flight],
    })),

  clearFlightResults: () => set({ flightResults: [] }),

  setCurrentStep: (step) => set({ currentStep: step }),

  setSweepExecutionId: (id) => set({ sweepExecutionId: id }),

  resetStore: () =>
    set({
      ticket: initialTicket,
      config: {
        ...initialConfig,
        directFlightOnly: false,
        timePreference: 'any',
        outboundTimePreference: 'any',
        inboundTimePreference: 'any',
      },
      metrics: initialMetrics,
      logs: [],
      flightResults: [],
      currentStep: 1,
      sweepExecutionId: null,
    }),

  isTicketExpired: () => {
    const { ticket } = get();
    if (!ticket.expirationDate) return false;
    return new Date(ticket.expirationDate) < new Date();
  },

  isRebookingMode: () => {
    const { ticket } = get();
    // Rebooking mode: original departure is in the past
    if (!ticket.departureDate) return false;
    return new Date(ticket.departureDate) < new Date();
  },

  isTicketValid: () => {
    const { ticket } = get();
    return (
      ticket.pnr.length >= 6 &&
      (ticket.primaryPassengerLastName || '').length > 0 &&
      ticket.passengers.length > 0 &&
      ticket.baseCost > 0 &&
      ticket.issueDate !== null &&
      ticket.expirationDate !== null
    );
  },

  isConfigValid: () => {
    const { config, ticket } = get();

    // For rebooking mode (original departure in past), allow any future date in 2026
    const isRebooking = ticket.departureDate && new Date(ticket.departureDate) < new Date();

    if (!ticket.expirationDate && !isRebooking) return false;

    const hasValidDates =
      config.searchWindowStart !== null &&
      config.searchWindowEnd !== null &&
      config.searchWindowStart <= config.searchWindowEnd;

    // In rebooking mode, validate against 2026-12-31; otherwise use expiration date
    const maxAllowedDate = isRebooking
      ? new Date('2026-12-31')
      : new Date(ticket.expirationDate!);

    const isWithinAllowedPeriod =
      config.searchWindowEnd !== null &&
      new Date(config.searchWindowEnd) <= maxAllowedDate;

    // Also ensure start date is in the future
    const isStartInFuture =
      config.searchWindowStart !== null &&
      new Date(config.searchWindowStart) >= new Date();

    const hasValidNights =
      config.minNights > 0 &&
      config.maxNights > 0 &&
      config.minNights <= config.maxNights;

    const hasValidTolerance = config.priceTolerance >= 0;
    const hasValidApiCalls = config.maxApiCalls > 0;

    return (
      hasValidDates &&
      isWithinAllowedPeriod &&
      isStartInFuture &&
      hasValidNights &&
      hasValidTolerance &&
      hasValidApiCalls
    );
  },
    }),
    { name: 'aerosweep-wizard-storage' }
  )
);
