'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp } from 'lucide-react';

function groupByNights(data: { nights: number; yield: number }[]) {
  if (data.length === 0) return [];
  
  const grouped: Record<number, { yields: number[] }> = {};
  
  data.forEach(d => {
    if (!grouped[d.nights]) {
      grouped[d.nights] = { yields: [] };
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

    return groupByNights(
      flightResults.map(f => ({ nights: f.nights, yield: f.yieldDelta }))
    );
  }, [flightResults]);

  const stats = useMemo(() => {
    if (chartData.length === 0) return { savings: 0, premium: 0, neutral: 0, bestYield: 0, bestNights: 0 };
    
    const allYields = flightResults.map(f => f.yieldDelta);
    const bestIdx = allYields.indexOf(Math.min(...allYields));
    const bestResult = flightResults[bestIdx];
    
    return {
      savings: chartData.filter(d => d.avgYield < -20).length,
      premium: chartData.filter(d => d.avgYield > 20).length,
      neutral: chartData.filter(d => Math.abs(d.avgYield) <= 20).length,
      bestYield: Math.min(...allYields),
      bestNights: bestResult?.nights || 0,
    };
  }, [chartData, flightResults]);

  const chartKey = `heuristic-${flightResults.length}`;

  return (
    <motion.div
      key={chartKey}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      className="border border-slate-800 rounded-sm bg-slate-900/50 p-2"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-3 h-3 text-emerald-400" />
          <h3 className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
            Yield by Duration
          </h3>
        </div>
      </div>
      
      {chartData.length > 0 && (
        <div className="grid grid-cols-4 gap-1 mb-1 px-1">
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Best</div>
            <div className="text-[9px] font-mono text-emerald-400">${Math.abs(stats.bestYield).toFixed(0)}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Days</div>
            <div className="text-[9px] font-mono text-slate-300">{stats.bestNights}N</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Savings</div>
            <div className="text-[9px] font-mono text-emerald-400">{stats.savings}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Premium</div>
            <div className="text-[9px] font-mono text-red-400">{stats.premium}</div>
          </div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={120}>
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
          <LineChart data={chartData} margin={{ top: 2, right: 8, left: -15, bottom: 2 }}>
            <CartesianGrid strokeDasharray="2 2" stroke="#1e293b" />
            <XAxis
              dataKey="nights"
              stroke="#e5e7eb"
              style={{ fontSize: '8px', fill: '#e5e7eb' }}
              domain={['dataMin - 1', 'dataMax + 1']}
              type="number"
              tickCount={8}
            />
            <YAxis
              dataKey="avgYield"
              stroke="#e5e7eb"
              style={{ fontSize: '8px', fill: '#e5e7eb' }}
              domain={['auto', 'auto']}
              tickFormatter={(val) => val < 0 ? `-$${Math.abs(val).toFixed(0)}` : `$${val.toFixed(0)}`}
            />
            <ReferenceLine y={0} stroke="#475569" strokeDasharray="2 2" strokeWidth={1} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '4px',
                fontSize: '10px',
                color: '#fff',
              }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value: any, name: string) => {
                if (name === 'avgYield') {
                  const num = Number(value);
                  return [num < 0 ? `-$${Math.abs(num).toFixed(2)}` : `$${num.toFixed(2)}`, 'Avg Yield'];
                }
                return [value, name];
              }}
              labelFormatter={(label) => `${label} Nights`}
            />
            <Line
              type="monotone"
              dataKey="avgYield"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: '#10b981', r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#10b981' }}
              isAnimationActive={false}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}
