'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { TerminalOutput } from '@/components/TerminalOutput';
import { FlightDataTable } from '@/components/FlightDataTable';
import { VolatilityChart } from '@/components/VolatilityChart';
import { HeuristicPathChart } from '@/components/HeuristicPathChart';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Activity, Target, TrendingDown, TrendingUp, XCircle, CheckCircle2 } from 'lucide-react';

export function ExecutionStep({ onBack }: { onBack: () => void }) {
  const { metrics, config, flightResults } = useTicketStore();
  const { isVisible: telemetryVisible } = useTelemetryStore();

  const bestYield = flightResults.length > 0
    ? Math.min(...flightResults.map(f => f.yieldDelta))
    : 0;
  
  const validCandidates = metrics.candidatesFound;
  const estVolume = (config.maxApiCalls || 100) * 1200;

  const bottomPadding = telemetryVisible ? 'pb-32' : 'pb-20';

  const MetricBox = ({ 
    label, 
    value, 
    subValue,
    variant = 'default',
    icon: Icon,
    className 
  }: { 
    label: string; 
    value: string | number; 
    subValue?: string;
    variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
    icon?: React.ElementType;
    className?: string;
  }) => {
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

  return (
    <div className="max-w-full mx-auto px-4 py-2 space-y-2">
      <div className="grid grid-cols-6 gap-1.5">
        <MetricBox
          label="Est. Volume"
          value={estVolume.toLocaleString()}
          subValue="Max API × 1200"
          variant="info"
          icon={Activity}
        />
        <MetricBox
          label="API Calls"
          value={`${metrics.totalScanned}/${config.maxApiCalls}`}
          variant="default"
          icon={Target}
        />
        <MetricBox
          label="Total Scanned"
          value={metrics.totalScanned.toLocaleString()}
          variant="default"
          icon={Activity}
        />
        <MetricBox
          label="Out of Range"
          value={metrics.outOfRange.toLocaleString()}
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
          label="Best Yield"
          value={bestYield < 0 ? `-$${Math.abs(bestYield).toFixed(2)}` : `+$${bestYield.toFixed(2)}`}
          subValue={bestYield < 0 ? 'Savings available' : 'Best option found'}
          variant={bestYield < 0 ? 'success' : 'warning'}
          icon={bestYield < 0 ? TrendingDown : TrendingUp}
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
