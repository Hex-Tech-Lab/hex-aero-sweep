'use client';

import { useTicketStore } from '@/src/store/useTicketStore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import { format, parseISO } from 'date-fns';

const BIN_SIZE = 5;

function binData(data: { date: string; price: number; yieldDelta: number }[], binSize: number) {
  if (data.length === 0) return [];
  
  const binned: { date: string; displayDate: string; price: number; yieldDelta: number; count: number }[] = [];
  
  for (let i = 0; i < data.length; i += binSize) {
    const chunk = data.slice(i, i + binSize);
    const avgPrice = chunk.reduce((sum, d) => sum + d.price, 0) / chunk.length;
    const avgYield = chunk.reduce((sum, d) => sum + d.yieldDelta, 0) / chunk.length;
    const midIdx = Math.floor(chunk.length / 2);
    const midDate = chunk[midIdx].date;
    
    let displayDate = midDate;
    try {
      displayDate = format(parseISO(midDate), 'MM-dd');
    } catch {
      displayDate = midDate.substring(5);
    }
    
    binned.push({
      date: midDate,
      displayDate,
      price: avgPrice,
      yieldDelta: avgYield,
      count: chunk.length,
    });
  }
  
  return binned;
}

export function VolatilityChart() {
  const { flightResults, ticket } = useTicketStore();

  const chartData = useMemo(() => {
    if (flightResults.length === 0) return [];

    const sorted = [...flightResults]
      .filter(f => f.status === 'verified' && f.departureDate)
      .filter(f => !isNaN(new Date(f.departureDate).getTime()))
      .sort((a, b) => new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime());

    if (sorted.length === 0) return [];

    return binData(
      sorted.map(f => ({ date: f.departureDate, price: f.price, yieldDelta: f.yieldDelta })),
      BIN_SIZE
    );
  }, [flightResults]);

  const volatilityMetrics = useMemo(() => {
    const verifiedFlights = flightResults.filter(f => f.status === 'verified' || f.status === 'live');
    if (verifiedFlights.length < 2) return { stdDev: 0, priceSpan: 0, minPrice: 0, maxPrice: 0, medianPrice: 0, volatility: 0 };
    
    const prices = verifiedFlights.map(f => f.price).sort((a, b) => a - b);
    const minPrice = prices[0];
    const maxPrice = prices[prices.length - 1];
    const medianPrice = prices.length % 2 === 0 
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2 
      : prices[Math.floor(prices.length / 2)];
    const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    const volatility = avg > 0 ? (stdDev / avg) * 100 : 0;
    
    return { stdDev, priceSpan: maxPrice - minPrice, minPrice, maxPrice, medianPrice, volatility };
  }, [flightResults]);

  const chartKey = `volatility-${flightResults.length}`;

  return (
    <motion.div
      key={chartKey}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className="border border-slate-800 rounded-sm bg-slate-900/50 p-2"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3 text-cyan-400" />
          <h3 className="text-[9px] font-semibold text-slate-400 uppercase tracking-wide">
            Price Trend
          </h3>
        </div>
      </div>
      
      {chartData.length > 0 && (
        <div className="grid grid-cols-4 gap-1 mb-1 px-1">
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Max</div>
            <div className="text-[9px] font-mono text-red-400">${volatilityMetrics.maxPrice.toFixed(0)}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Min</div>
            <div className="text-[9px] font-mono text-emerald-400">${volatilityMetrics.minPrice.toFixed(0)}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Med</div>
            <div className="text-[9px] font-mono text-slate-300">${volatilityMetrics.medianPrice.toFixed(0)}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-slate-500 uppercase">Vol%</div>
            <div className="text-[9px] font-mono text-amber-400">{volatilityMetrics.volatility.toFixed(1)}%</div>
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
            <Activity className="w-6 h-6 mb-1" />
            <span className="text-[9px] uppercase tracking-wider">Awaiting...</span>
          </motion.div>
        ) : (
          <LineChart data={chartData} margin={{ top: 2, right: 8, left: -15, bottom: 35 }}>
            <CartesianGrid strokeDasharray="2 2" stroke="#1e293b" />
            <XAxis
              dataKey="displayDate"
              stroke="#e5e7eb"
              style={{ fontSize: '7px', fill: '#e5e7eb' }}
              interval="preserveStartEnd"
              angle={-45}
              textAnchor="end"
              height={40}
            />
            <YAxis 
              stroke="#e5e7eb" 
              style={{ fontSize: '7px', fill: '#e5e7eb' }} 
              domain={['dataMin - 50', 'dataMax + 50']}
              tickFormatter={(val) => `$${val.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '4px',
                fontSize: '10px',
                color: '#fff',
              }}
              labelStyle={{ color: '#e5e7eb' }}
              formatter={(value: any) => [`$${Number(value).toFixed(2)}`, 'Avg Price']}
              labelFormatter={(label) => `${label}`}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#06b6d4"
              strokeWidth={2}
              dot={{ r: 3, fill: '#06b6d4', strokeWidth: 0 }}
              activeDot={{ r: 5, fill: '#06b6d4' }}
              name="Price"
              isAnimationActive={false}
            />
            {ticket.baseCost > 0 && (
              <ReferenceLine
                y={ticket.baseCost}
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="3 3"
                label={{ value: 'Base', position: 'right', fill: '#ef4444', fontSize: 6 }}
              />
            )}
          </LineChart>
        )}
      </ResponsiveContainer>
    </motion.div>
  );
}
