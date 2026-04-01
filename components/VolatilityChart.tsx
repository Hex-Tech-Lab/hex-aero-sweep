'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';

export function VolatilityChart() {
  const { flightResults, ticket } = useTicketStore();

  const chartData = useMemo(() => {
    if (flightResults.length === 0) return [];

    const verified = flightResults.filter(f => f.status === 'verified' || f.status === 'live');
    
    if (verified.length === 0) {
      return flightResults.slice(0, 500).map((flight, index) => ({
        index,
        date: flight.departureDate,
        price: flight.price,
        yieldDelta: flight.yieldDelta,
        status: flight.status,
      }));
    }

    return verified.slice(0, 500).map((flight, index) => ({
      index,
      date: flight.departureDate,
      price: flight.price,
      yieldDelta: flight.yieldDelta,
      status: flight.status,
    }));
  }, [flightResults]);

  const volatilityMetrics = useMemo(() => {
    const verified = flightResults.filter(f => f.status === 'verified' || f.status === 'live');
    const source = verified.length > 0 ? verified : flightResults;
    
    if (source.length < 2) return { stdDev: 0, priceSpan: 0, minPrice: 0, maxPrice: 0 };
    
    const prices = source.map(f => f.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const priceSpan = maxPrice - minPrice;
    
    return { stdDev, priceSpan, minPrice, maxPrice };
  }, [flightResults]);

  const chartKey = `volatility-${flightResults.length}`;

  return (
    <motion.div
      key={chartKey}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="border border-slate-800 rounded-sm bg-slate-900/50 p-3"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-cyan-400" />
          <h3 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wide">
            Price Volatility
          </h3>
        </div>
        {chartData.length > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 300 }}
            className="flex items-center gap-2 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 rounded text-[10px]"
          >
            <div className="flex items-center gap-1">
              <span className="text-slate-500">Min</span>
              <span className="font-mono font-bold text-emerald-400">
                ${volatilityMetrics.minPrice.toFixed(0)}
              </span>
            </div>
            <div className="w-px h-3 bg-slate-700" />
            <div className="flex items-center gap-1">
              <span className="text-slate-500">Max</span>
              <span className="font-mono font-bold text-red-400">
                ${volatilityMetrics.maxPrice.toFixed(0)}
              </span>
            </div>
            <div className="w-px h-3 bg-slate-700" />
            <div className="flex items-center gap-1">
              <span className="text-slate-500">Span</span>
              <span className="font-mono font-bold text-cyan-400">
                ${volatilityMetrics.priceSpan.toFixed(0)}
              </span>
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
            <Activity className="w-8 h-8 mb-1" />
            <span className="text-[10px] uppercase tracking-wider">Awaiting Stream...</span>
          </motion.div>
        ) : (
          <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="date"
              stroke="#475569"
              style={{ fontSize: '8px' }}
              angle={-45}
              textAnchor="end"
              height={40}
              tickFormatter={(val) => String(val).replace('2026-', '').substring(0, 5)}
            />
            <YAxis stroke="#475569" style={{ fontSize: '8px' }} domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '2px',
                fontSize: '10px',
              }}
              formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Price']}
            />
            <Legend wrapperStyle={{ fontSize: '8px' }} />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#06b6d4"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, fill: '#06b6d4' }}
              name="Price"
              isAnimationActive={false}
            />
            {ticket.baseCost > 0 && (
              <ReferenceLine
                y={ticket.baseCost}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 4"
                label={{ value: 'Base', position: 'right', fill: '#ef4444', fontSize: 8 }}
              />
            )}
          </LineChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}
