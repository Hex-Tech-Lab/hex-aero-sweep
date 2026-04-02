'use client';

import { useMemo } from 'react';
import type { ElementType } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { TerminalOutput } from '@/components/TerminalOutput';
import { FlightDataTable } from '@/components/FlightDataTable';
import { VolatilityChart } from '@/components/VolatilityChart';
import { HeuristicPathChart } from '@/components/HeuristicPathChart';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Activity, Target, TrendingDown, TrendingUp, XCircle, CheckCircle2, Star } from 'lucide-react';

type MetricBoxProps = {
  label: string;
  value: string | number;
  subValue?: string;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  icon?: ElementType;
  className?: string;
};

const MetricBox = ({
  label,
  value,
  subValue,
  variant = 'default',
  icon: Icon,
  className
}: MetricBoxProps) => {
  const variantStyles = {
    default: 'text-blue-400',
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
    info: 'text-cyan-400',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'border border-slate-800 rounded-sm bg-slate-900/50 p-2',
        className
      )}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider font-medium">
          {label}
        </span>
        {Icon && <Icon className={cn('w-3 h-3', variantStyles[variant])} />}
      </div>
      <div className={cn('text-lg font-bold font-mono', variantStyles[variant])}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {subValue && (
        <div className="text-[9px] text-slate-600 font-mono">
          {subValue}
        </div>
      )}
    </motion.div>
  );
};

export function ExecutionStep({ onBack }: { onBack: () => void }) {
  const { metrics, config, flightResults } = useTicketStore();
  const { isVisible: telemetryVisible } = useTelemetryStore();

  const verifiedResults = flightResults.filter(f => f.status === 'verified');
  const validCandidates = metrics?.candidatesFound || 0;
  const totalScanned = metrics?.totalScanned || 0;
  const outOfRange = metrics?.outOfRange || 0;
  const estVolume = (config.maxApiCalls || 100) * 1200;

  const metricsData = useMemo(() => {
    const rankedResults = flightResults.filter(f => f.status === 'verified' || f.status === 'live');
    const bestCount = rankedResults.length > 0 ? Math.min(rankedResults.length, 3) : 0;
    const yieldNum = rankedResults.length > 0 ? Math.min(...rankedResults.map(f => f.yieldDelta)) : null;
    const display = yieldNum !== null ? (yieldNum < 0 ? `-$${Math.abs(yieldNum).toFixed(2)}` : `+$${yieldNum.toFixed(2)}`) : '-';
    return { count: bestCount, yieldVal: yieldNum, display, isNegative: yieldNum !== null && yieldNum < 0 };
  }, [flightResults]);

  const bottomPadding = telemetryVisible ? 'pb-48' : 'pb-20';

  return (
    <div className="max-w-full mx-auto px-4 py-2 space-y-2">
      <div className="grid grid-cols-7 gap-1.5">
        <MetricBox
          label="Est. Volume"
          value={estVolume.toLocaleString()}
          subValue="Max API × 1200"
          variant="info"
          icon={Activity}
        />
        <MetricBox
          label="API Calls"
          value={metrics?.progress || '0/0'}
          variant="default"
          icon={Target}
        />
        <MetricBox
          label="Total Scanned"
          value={totalScanned.toLocaleString()}
          variant="default"
          icon={Activity}
        />
        <MetricBox
          label="Out of Range"
          value={outOfRange.toLocaleString()}
          variant="error"
          icon={XCircle}
        />
        <MetricBox
          label="Valid Candidates"
          value={validCandidates.toLocaleString()}
          variant="success"
          icon={CheckCircle2}
        />
        <MetricBox
          label="Top Matches"
          value={metricsData.count}
          subValue="Verified"
          variant="success"
          icon={Star}
        />
        <MetricBox
          label="Best Yield"
          value={metricsData.display}
          subValue={metricsData.isNegative ? 'Savings available' : 'Best option found'}
          variant={metricsData.isNegative ? 'success' : 'warning'}
          icon={metricsData.isNegative ? TrendingDown : TrendingUp}
        />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <VolatilityChart />
        <HeuristicPathChart />
      </div>

      <FlightDataTable />

      <div className={bottomPadding}>
        <h3 className="text-[9px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
          Terminal Output
        </h3>
        <div className="border border-slate-800 rounded-sm bg-slate-950 overflow-hidden">
          <TerminalOutput />
        </div>
      </div>
    </div>
  );
}
