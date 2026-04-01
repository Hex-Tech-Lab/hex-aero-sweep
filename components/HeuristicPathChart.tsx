'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

export function HeuristicPathChart() {
  const { flightResults } = useTicketStore();

  const chartData = useMemo(() => {
    return flightResults.map((flight) => ({
      nights: flight.nights,
      yield: flight.yieldDelta,
      carrier: flight.carrier,
      status: flight.status,
      price: flight.price,
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="border border-slate-800 rounded-sm bg-slate-900/50 p-4"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Heuristic Path Visualization
          </h3>
        </div>
        {chartData.length > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 200 }}
            className="flex items-center gap-3 text-[10px]"
          >
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-slate-400">{stats.positive} Savings</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="text-slate-400">{stats.neutral} Neutral</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-slate-400">{stats.negative} Premium</span>
            </div>
          </motion.div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        {chartData.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="flex flex-col items-center justify-center h-full text-slate-600"
          >
            <TrendingUp className="w-12 h-12 mb-2" />
            <span className="text-xs uppercase tracking-wider">Awaiting Data Points...</span>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="nights"
                stroke="#475569"
                style={{ fontSize: '10px' }}
                label={{ value: 'Duration (nights)', position: 'bottom', fill: '#64748b', fontSize: 10 }}
              />
              <YAxis
                dataKey="yield"
                stroke="#475569"
                style={{ fontSize: '10px' }}
                label={{ value: 'Yield Delta ($)', angle: -90, position: 'left', fill: '#64748b', fontSize: 10 }}
              />
              <ReferenceLine y={0} stroke="#475569" strokeDasharray="3 3" strokeWidth={1} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '2px',
                  fontSize: '12px',
                }}
                formatter={(value: any, name: string) => {
                  if (name === 'yield') return [`$${value.toFixed(2)}`, 'Yield Delta'];
                  if (name === 'price') return [`$${value.toFixed(2)}`, 'Total Price'];
                  return [value, name];
                }}
              />
              <Scatter data={chartData} animationDuration={1500}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getColor(entry.status)} opacity={0.8} />
                ))}
              </Scatter>
            </ScatterChart>
          </motion.div>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}
