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
import { Activity, Target, TrendingDown, TrendingUp, XCircle, CheckCircle2, Star, Calendar, PlaneTakeoff } from 'lucide-react';

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
  const { metrics, config, flightResults, ticket } = useTicketStore();
  const { isVisible: telemetryVisible } = useTelemetryStore();

  const verifiedResults = flightResults.filter(f => f.status === 'verified');
  const validCandidates = verifiedResults.length || 0;
  const totalScanned = flightResults.length || 0;
  const outOfRange = Math.max(0, totalScanned - validCandidates);
  const estVolume = (config.maxApiCalls || 100) * 1200;

  const metricsData = useMemo(() => {
    const rankedResults = flightResults.filter(f => f.status === 'verified' || f.status === 'live');
    const bestCount = rankedResults.length > 0 ? Math.min(rankedResults.length, 3) : 0;
    const yieldNum = rankedResults.length > 0 ? Math.min(...rankedResults.map(f => f.yieldDelta)) : null;
    const display = yieldNum !== null ? (yieldNum < 0 ? `-$${Math.abs(yieldNum).toFixed(2)}` : `+$${yieldNum.toFixed(2)}`) : '-';
    return { count: bestCount, yieldVal: yieldNum, display, isNegative: yieldNum !== null && yieldNum < 0 };
  }, [flightResults]);

  const today = new Date();
  const todayDisplay = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  
  const departureDate = ticket?.departureDate ? new Date(ticket.departureDate) : null;
  const departureDisplay = departureDate 
    ? departureDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '--';
  
  const isPreDeparture = departureDate ? today < departureDate : true;
  const daysToDeparture = departureDate 
    ? Math.ceil((departureDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const bottomPadding = telemetryVisible ? 'mb-48' : 'mb-20';

  return (
    <div className="w-full px-4 py-2 space-y-2 max-w-[100vw] overflow-x-hidden">
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-9 gap-2 w-full">
        <MetricBox
          label="Today"
          value={todayDisplay}
          subValue={today.toLocaleDateString('en-US', { weekday: 'short' })}
          variant="info"
          icon={Calendar}
        />
        <MetricBox
          label="Departure"
          value={departureDisplay}
          subValue={daysToDeparture !== null ? `${daysToDeparture}D` : ''}
          variant={isPreDeparture ? 'warning' : 'error'}
          icon={PlaneTakeoff}
        />
        <MetricBox
          label="Est. Volume"
          value={Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.min(estVolume, 999999))}
          subValue="Max×1200"
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
          value={Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.min(totalScanned, 999999))}
          variant="default"
          icon={Activity}
        />
        <MetricBox
          label="Out of Range"
          value={Math.min(outOfRange, 9999).toLocaleString()}
          variant="error"
          icon={XCircle}
        />
        <MetricBox
          label="Valid"
          value={Math.min(validCandidates, 9999).toLocaleString()}
          variant="success"
          icon={CheckCircle2}
        />
        <MetricBox
          label="Matches"
          value={metricsData.count}
          subValue="Top"
          variant="success"
          icon={Star}
        />
        <MetricBox
          label="Best Yield"
          value={metricsData.display}
          subValue={metricsData.isNegative ? '↓ Save' : '↑ Best'}
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
        <div className="border border-slate-800 rounded-sm bg-slate-950 overflow-hidden flex-1 min-h-[200px]">
          <TerminalOutput />
        </div>
      </div>
    </div>
  );
}
