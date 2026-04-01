'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

export function HeuristicPathChart() {
  const { flightResults } = useTicketStore();

  const chartData = useMemo(() => {
    const source = flightResults.slice(0, 500);
    return source.map((flight) => ({
      nights: flight.nights,
      yield: flight.yieldDelta,
      carrier: flight.carrier,
      status: flight.status,
      price: flight.price,
      id: flight.id,
    }));
  }, [flightResults]);

  const getColor = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower.includes('live') || statusLower.includes('verified')) return '#06b6d4';
    if (statusLower.includes('date') || statusLower.includes('flex')) return '#fb923c';
    if (statusLower.includes('route') || statusLower.includes('expansion')) return '#10b981';
    return '#64748b';
  };

  const stats = useMemo(() => {
    if (chartData.length === 0) return { positive: 0, negative: 0, neutral: 0 };
    return {
      positive: chartData.filter(d => d.yield < -20).length,
      negative: chartData.filter(d => d.yield > 20).length,
      neutral: chartData.filter(d => Math.abs(d.yield) <= 20).length,
    };
  }, [chartData]);

  const chartKey = `heuristic-${flightResults.length}`;

  return (
    <motion.div
      key={chartKey}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="border border-slate-800 rounded-sm bg-slate-900/50 p-3"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <h3 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
            Heuristic Path
          </h3>
        </div>
        {chartData.length > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 300 }}
            className="flex items-center gap-2 text-[9px]"
          >
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-slate-400">{stats.positive}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              <span className="text-slate-400">{stats.neutral}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-slate-400">{stats.negative}</span>
            </div>
          </motion.div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={160}>
        {chartData.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="flex flex-col items-center justify-center h-full text-slate-600"
          >
            <TrendingUp className="w-8 h-8 mb-1" />
            <span className="text-[10px] uppercase tracking-wider">Awaiting Data...</span>
          </motion.div>
        ) : (
          <ScatterChart margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="nights"
              stroke="#475569"
              style={{ fontSize: '8px' }}
              label={{ value: 'Nights', position: 'bottom', fill: '#64748b', fontSize: 8 }}
              domain={[0, 'auto']}
              type="number"
            />
            <YAxis
              dataKey="yield"
              stroke="#475569"
              style={{ fontSize: '8px' }}
              label={{ value: 'Yield', angle: -90, position: 'left', fill: '#64748b', fontSize: 8 }}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" strokeWidth={1} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '2px',
                fontSize: '10px',
              }}
              formatter={(value: any, name: string) => {
                if (name === 'yield') return [`$${Number(value).toFixed(2)}`, 'Yield'];
                if (name === 'price') return [`$${Number(value).toFixed(2)}`, 'Price'];
                return [value, name];
              }}
            />
            <Scatter data={chartData} isAnimationActive={false}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${entry.id || index}`}
                  fill={getColor(entry.status)}
                  fillOpacity={0.7}
                />
              ))}
            </Scatter>
          </ScatterChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}
