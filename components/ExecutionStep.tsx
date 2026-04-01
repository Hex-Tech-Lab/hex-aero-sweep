'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { GlobalHeader } from '@/components/GlobalHeader';
import { MetricCard } from '@/components/MetricCard';
import { TerminalOutput } from '@/components/TerminalOutput';
import { FlightDataTable } from '@/components/FlightDataTable';
import { VolatilityChart } from '@/components/VolatilityChart';
import { HeuristicPathChart } from '@/components/HeuristicPathChart';
import { motion } from 'framer-motion';

export function ExecutionStep({ onBack }: { onBack: () => void }) {
  const { metrics } = useTicketStore();
  const { isVisible: telemetryVisible } = useTelemetryStore();

  const bottomPadding = telemetryVisible ? 'pb-32' : 'pb-20';

  return (
    <div className="min-h-screen bg-slate-950">
      <GlobalHeader mode="execution" onBack={onBack} />

      <div className="max-w-full mx-auto px-4 py-3 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <MetricCard
            label="Total Scanned"
            value={metrics.totalScanned.toLocaleString()}
            variant="default"
          />
          <MetricCard
            label="Candidates"
            value={metrics.candidatesFound.toLocaleString()}
            variant="success"
          />
          <MetricCard
            label="Out of Range"
            value={metrics.outOfRange.toLocaleString()}
            variant="error"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <VolatilityChart />
          <HeuristicPathChart />
        </div>

        <FlightDataTable />

        <div className={bottomPadding}>
          <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Terminal Output
          </h3>
          <div className="border border-slate-800 rounded-sm bg-slate-900 overflow-hidden">
            <TerminalOutput />
          </div>
        </div>
      </div>
    </div>
  );
}
