'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

function groupByNights(data: { nights: number; yield: number }[]) {
  if (data.length === 0) return [];
  
  const grouped: Record<number, { yields: number[]; prices: number[] }> = {};
  
  data.forEach(d => {
    if (!grouped[d.nights]) {
      grouped[d.nights] = { yields: [], prices: [] };
    }
    grouped[d.nights].yields.push(d.yield);
  });
  
  return Object.entries(grouped)
    .map(([night, { yields }]) => ({
      nights: parseInt(night),
      avgYield: yields.reduce((a, b) => a + b, 0) / yields.length,
      minYield: Math.min(...yields),
      maxYield: Math.max(...yields),
      count: yields.length,
    }))
    .sort((a, b) => a.nights - b.nights);
}

export function HeuristicPathChart() {
  const { flightResults } = useTicketStore();

  const chartData = useMemo(() => {
    if (flightResults.length === 0) return [];

    const sliced = flightResults.slice(0, 500);
    return groupByNights(
      sliced.map(f => ({ nights: f.nights, yield: f.yieldDelta }))
    );
  }, [flightResults]);

  const stats = useMemo(() => {
    if (chartData.length === 0) return { positive: 0, negative: 0, neutral: 0 };
    return {
      positive: chartData.filter(d => d.avgYield < -20).length,
      negative: chartData.filter(d => d.avgYield > 20).length,
      neutral: chartData.filter(d => Math.abs(d.avgYield) <= 20).length,
    };
  }, [chartData]);

  const chartKey = `heuristic-${flightResults.length}`;

  return (
    <motion.div
      key={chartKey}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="border border-slate-800 rounded-sm bg-slate-900/50 p-2"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3 text-emerald-400" />
          <h3 className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
            Yield by Duration
          </h3>
        </div>
        {chartData.length > 0 && (
          <div className="flex items-center gap-1 text-[8px]">
            <div className="flex items-center gap-0.5">
              <div className="w-1 h-1 rounded-full bg-emerald-400" />
              <span className="text-slate-500">{stats.positive}</span>
            </div>
            <div className="flex items-center gap-0.5">
              <div className="w-1 h-1 rounded-full bg-slate-400" />
              <span className="text-slate-500">{stats.neutral}</span>
            </div>
          </div>
        )}
      </div>

      <ResponsiveContainer width="100%" height={140}>
        {chartData.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="flex flex-col items-center justify-center h-full text-slate-600"
          >
            <TrendingUp className="w-6 h-6 mb-1" />
            <span className="text-[9px] uppercase tracking-wider">Awaiting...</span>
          </motion.div>
        ) : (
          <LineChart data={chartData} margin={{ top: 2, right: 5, left: -10, bottom: 2 }}>
            <CartesianGrid strokeDasharray="2 2" stroke="#1e293b" />
            <XAxis
              dataKey="nights"
              stroke="#475569"
              style={{ fontSize: '8px' }}
              domain={['dataMin - 1', 'dataMax + 1']}
              type="number"
              tickCount={8}
              label={{ value: 'Nights', position: 'bottom', fill: '#64748b', fontSize: 7 }}
            />
            <YAxis
              dataKey="avgYield"
              stroke="#475569"
              style={{ fontSize: '8px' }}
              domain={['auto', 'auto']}
              tickFormatter={(val) => `$${val.toFixed(0)}`}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" strokeWidth={1} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '2px',
                fontSize: '9px',
              }}
              formatter={(value: any, name: string) => {
                if (name === 'avgYield') return [`$${Number(value).toFixed(2)}`, 'Avg Yield'];
                return [value, name];
              }}
              labelFormatter={(label) => `${label} Nights`}
            />
            <Line
              type="monotone"
              dataKey="avgYield"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: '#10b981', r: 3 }}
              activeDot={{ r: 4, fill: '#10b981' }}
              name="Avg Yield"
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}
