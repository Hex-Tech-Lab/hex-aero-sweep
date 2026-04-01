import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

type MetricCardProps = {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  variant?: 'default' | 'success' | 'warning' | 'error';
  className?: string;
};

export function MetricCard({
  label,
  value,
  icon: Icon,
  variant = 'default',
  className,
}: MetricCardProps) {
  const variantStyles = {
    default: 'text-blue-400',
    success: 'text-green-400',
    warning: 'text-yellow-400',
    error: 'text-red-400',
  };

  return (
    <div className={cn('metric-card', className)}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-slate-500 uppercase tracking-wide font-medium">
          {label}
        </span>
        {Icon && <Icon className="w-3 h-3 text-slate-600" />}
      </div>
      <div className={cn('text-3xl font-bold', variantStyles[variant])}>
        {value}
      </div>
    </div>
  );
}
