'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';

export function VolatilityChart() {
  const { flightResults, ticket } = useTicketStore();

  const chartData = useMemo(() => {
    if (flightResults.length === 0) return [];

    const groupedByDate = flightResults.reduce((acc, flight) => {
      if (!acc[flight.departureDate]) {
        acc[flight.departureDate] = [];
      }
      acc[flight.departureDate].push(flight.price);
      return acc;
    }, {} as Record<string, number[]>);

    return Object.entries(groupedByDate)
      .map(([date, prices]) => ({
        date,
        avgPrice: prices.reduce((sum, p) => sum + p, 0) / prices.length,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [flightResults]);

  const volatilityScore = useMemo(() => {
    if (chartData.length < 2) return 0;
    const prices = chartData.map(d => d.avgPrice);
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
    return Math.sqrt(variance);
  }, [chartData]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="border border-slate-800 rounded-sm bg-slate-900/50 p-4"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            Price Volatility Analysis
          </h3>
        </div>
        {chartData.length > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 200 }}
            className="flex items-center gap-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded"
          >
            <span className="text-[10px] text-slate-400 uppercase">Volatility</span>
            <span className="text-sm font-mono font-bold text-cyan-400">
              ${volatilityScore.toFixed(2)}
            </span>
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
            <Activity className="w-12 h-12 mb-2" />
            <span className="text-xs uppercase tracking-wider">Awaiting Price Stream...</span>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                stroke="#475569"
                style={{ fontSize: '10px' }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis stroke="#475569" style={{ fontSize: '10px' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '2px',
                  fontSize: '12px',
                }}
                formatter={(value: any) => [`$${value.toFixed(2)}`, 'Price']}
              />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Line
                type="monotone"
                dataKey="avgPrice"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={{ fill: '#06b6d4', r: 3 }}
                name="Avg Price"
                animationDuration={1500}
              />
              <Line
                type="monotone"
                dataKey="minPrice"
                stroke="#10b981"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                name="Min Price"
                animationDuration={1500}
              />
              <Line
                type="monotone"
                dataKey="maxPrice"
                stroke="#f97316"
                strokeWidth={1}
                strokeDasharray="3 3"
                dot={false}
                name="Max Price"
                animationDuration={1500}
              />
              {ticket.baseCost > 0 && (
                <Line
                  type="monotone"
                  dataKey={() => ticket.baseCost}
                  stroke="#ef4444"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="Base Cost"
                  animationDuration={800}
                />
              )}
            </LineChart>
          </motion.div>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}
