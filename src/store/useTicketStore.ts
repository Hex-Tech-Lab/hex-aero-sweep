import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
  // Direct passenger counts for RPC calls (extracted from passengerBreakdown)
  passengerAdults: number;
  passengerChildren: number;
  rules: {
    validity: string;
    luggage: string;
    cancellation: string;
  };
  // Airline Intelligence Schema fields
  carrier?: string; // IATA code e.g., 'A3'
  origin?: string;   // IATA origin e.g., 'CAI'
  destination?: string; // IATA destination e.g., 'ATH'
  bookingClass?: string; // Raw booking class from ticket e.g., 'K'
  // Fare Family Resolution
  fareFamilyId?: string | null;
  fareFamilyName?: string | null;
  parityTier?: number | null;
  isDomestic?: boolean;
  anchorTier?: number; // The parity_tier used as anchor for comparisons
  dbTicketId?: string; // Reference to tickets table
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
  apiCallsMade?: number;
  maxApiCalls?: number;
  skippedDuplicates?: number;
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
  bookingClass?: string;
  resolvedFamilyId?: string | null;
  resolvedFamilyName?: string | null;
  parityTier?: number;
  penaltyBadge?: string | null;
  outboundSegments?: Array<{
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    carrier: string;
    flightNumber: string;
    duration: string;
  }>;
  inboundSegments?: Array<{
    origin: string;
    destination: string;
    departureTime: string;
    arrivalTime: string;
    carrier: string;
    flightNumber: string;
    duration: string;
  }>;
  metadata: Record<string, any>;
};

export type CarrierInfo = {
  iata_code: string;
  name: string;
  logo_symbol_url: string | null;
  logo_lockup_url: string | null;
  logo_symbol_dark_url: string | null;
  logo_lockup_dark_url: string | null;
};

type TicketStore = {
  ticket: TicketData;
  config: ConfigData;
  metrics: ExecutionMetrics;
  logs: TerminalLog[];
  flightResults: FlightResult[];
  currentStep: number;
  sweepExecutionId: string | null;
  searchJobId: string | null; // Airline schema search job ID
  carrierCache: Map<string, CarrierInfo>;

  setTicket: (ticket: Partial<TicketData>) => void;
  setConfig: (config: Partial<ConfigData>) => void;
  setMetrics: (metrics: Partial<ExecutionMetrics>) => void;
  addLog: (log: Omit<TerminalLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  addFlightResult: (flight: FlightResult) => void;
  clearFlightResults: () => void;
  setCurrentStep: (step: number) => void;
  setSweepExecutionId: (id: string | null) => void;
  setSearchJobId: (id: string | null) => void;
  setFareFamily: (fareFamilyId: string | null, fareFamilyName: string | null, parityTier: number | null, isDomestic: boolean | undefined) => void;
  setCarrierCache: (carriers: CarrierInfo[]) => void;
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
  passengerBreakdown: undefined,
  passengerAdults: 1,
  passengerChildren: 0,
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
  searchJobId: null,
  carrierCache: new Map<string, CarrierInfo>(),

  setCarrierCache: (carriers: CarrierInfo[]) =>
    set((state) => {
      const newCache = new Map<string, CarrierInfo>();
      for (const c of carriers) {
        newCache.set(c.iata_code, c);
      }
      return { carrierCache: newCache };
    }),

  setTicket: (ticket) =>
    set((state) => {
      const updated = { ...state.ticket, ...ticket };
      // Auto-extract passenger counts from passengerBreakdown when it changes
      if (ticket.passengerBreakdown !== undefined) {
        updated.passengerAdults = ticket.passengerBreakdown?.adults ?? 1;
        updated.passengerChildren = ticket.passengerBreakdown?.children ?? 0;
      }
      return { ticket: updated };
    }),

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

  setSearchJobId: (id) => set({ searchJobId: id }),

  setFareFamily: (fareFamilyId, fareFamilyName, parityTier, isDomestic) =>
    set((state) => ({
      ticket: {
        ...state.ticket,
        fareFamilyId,
        fareFamilyName,
        parityTier,
        isDomestic,
        anchorTier: parityTier ?? undefined,
      },
    })),

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
      searchJobId: null,
      carrierCache: new Map<string, CarrierInfo>(),
    }),

  isTicketExpired: () => {
    const { ticket } = get();
    if (!ticket.expirationDate) return false;
    return new Date(ticket.expirationDate) < new Date();
  },

  isRebookingMode: () => {
    const { ticket } = get();
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

    const isRebooking = ticket.departureDate && new Date(ticket.departureDate) < new Date();

    if (!ticket.expirationDate && !isRebooking) return false;

    const hasValidDates =
      config.searchWindowStart !== null &&
      config.searchWindowEnd !== null &&
      config.searchWindowStart <= config.searchWindowEnd;

    const maxAllowedDate = isRebooking
      ? new Date('2026-12-31')
      : new Date(ticket.expirationDate!);

    const isWithinAllowedPeriod =
      config.searchWindowEnd !== null &&
      new Date(config.searchWindowEnd) <= maxAllowedDate;

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
{
  name: 'aerosweep-ticket-store',
  storage: createJSONStorage(() => sessionStorage),
  partialize: (state) => ({
    ticket: state.ticket,
    config: state.config,
    metrics: state.metrics,
    flightResults: state.flightResults,
    currentStep: state.currentStep,
  }),
}
));
