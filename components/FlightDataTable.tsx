'use client';

import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useTicketStore, FlightResult } from '@/src/store/useTicketStore';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Plane, Clock, ArrowRight, Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';

type SortConfig = {
  key: string;
  direction: 'asc' | 'desc';
};

type FlightSegment = {
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  terminal?: string;
};

type FlightWithSegments = FlightResult & {
  outboundSegments: FlightSegment[];
  inboundSegments: FlightSegment[];
};

const ROWS_PER_PAGE = 10;

const CARRIER_NAMES: Record<string, string> = {
  'A3': 'Aegean Airlines',
  'BA': 'British Airways',
  'LH': 'Lufthansa',
  'AF': 'Air France',
  'KL': 'KLM',
  'IB': 'Iberia',
  'AZ': 'ITA Airways',
  'SK': 'SAS',
  'AY': 'Finnair',
  'QR': 'Qatar Airways',
  'EK': 'Emirates',
  'TK': 'Turkish Airlines',
  'FR': 'Ryanair',
  'U2': 'EasyJet',
  'VY': 'Vueling',
  '5N': 'Smartavia',
  'S7': 'S7 Airlines',
};

type FlightRowProps = {
  flight: any;
  idx: number;
  isOutOfRange: boolean;
  isActive: boolean;
  isTopMatch: boolean;
  onClick: () => void;
  fareBrand: (f: any) => string;
  formatOutboundDate: (f: any) => string;
  formatOutboundTime: (f: any) => string;
  formatInboundDate: (f: any) => string;
  formatInboundTime: (f: any) => string;
  getStatusColor: (d: number) => string;
  getStatusBadge: (s: string) => React.ReactNode;
};

  const MemoizedFlightRow = memo(function MemoizedFlightRow({
  flight,
  idx,
  isOutOfRange,
  isActive,
  isTopMatch,
  onClick,
  fareBrand,
  formatOutboundDate,
  formatOutboundTime,
  formatInboundDate,
  formatInboundTime,
  getStatusColor,
  getStatusBadge,
}: FlightRowProps) {
  const fb = fareBrand(flight);
  return (
    <TableRow
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick();
        if (e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      tabIndex={0}
      role="button"
      className={cn(
        'cursor-pointer transition-colors border-b border-slate-800/50',
        'hover:bg-slate-800/30',
        idx % 2 === 0 ? 'bg-slate-900/30' : 'bg-slate-900/60',
        isOutOfRange && 'opacity-60',
        isActive && 'bg-blue-900/40 border-l-2 border-l-cyan-400',
        isTopMatch && 'bg-amber-900/20 border-l-2 border-amber-500'
      )}
    >
      <TableCell className={cn('font-mono font-semibold text-[10px] px-2', isOutOfRange ? 'text-slate-400' : 'text-slate-100')}>
        {flight.carrier}
      </TableCell>
      <TableCell className={cn('font-mono text-[10px] px-2', isOutOfRange ? 'text-slate-600' : 'text-slate-300')}>
        {formatOutboundDate(flight)}
      </TableCell>
      <TableCell className={cn('font-mono text-[10px] px-2', isOutOfRange ? 'text-slate-600' : 'text-slate-300')}>
        {formatOutboundTime(flight)}
      </TableCell>
      <TableCell className={cn('font-mono text-[10px] px-2', isOutOfRange ? 'text-slate-600' : 'text-slate-300')}>
        {formatInboundDate(flight)}
      </TableCell>
      <TableCell className={cn('font-mono text-[10px] px-2', isOutOfRange ? 'text-slate-600' : 'text-slate-300')}>
        {formatInboundTime(flight)}
      </TableCell>
      <TableCell className="text-center px-2">
        <span className="text-[10px] font-mono text-slate-400 uppercase">
          {flight.metadata?.cabinClass || 'Eco'}
        </span>
      </TableCell>
      <TableCell className="px-2">
        <Badge
          variant={fb !== 'Standard' ? 'default' : 'outline'}
          className={cn(
            'text-[8px] py-0 px-1',
            fb === 'Light' && 'bg-amber-500/20 text-amber-400 border-amber-500/30',
            fb === 'Flex' && 'bg-blue-500/20 text-blue-400 border-blue-500/30',
            fb === 'Plus' && 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
            fb === 'Standard' && 'text-slate-500 border-slate-600/30'
          )}
        >
          {fb}
        </Badge>
      </TableCell>
      <TableCell className="text-center px-2">
        <span className="text-[10px] font-mono text-slate-400">
          {flight.metadata?.bookingClass || '-'}
        </span>
      </TableCell>
      <TableCell className="text-center px-2">
        <span className="text-[10px] font-mono text-slate-400">
          {flight.nights}N
        </span>
      </TableCell>
      <TableCell className={cn('text-right font-mono font-semibold text-[10px] px-2', isOutOfRange ? 'text-slate-500' : 'text-slate-100')}>
        ${flight.price.toFixed(2)}
      </TableCell>
      <TableCell
        className={cn('text-right font-mono font-bold text-[10px] px-2', isOutOfRange ? 'text-slate-500' : getStatusColor(flight.yieldDelta))}
      >
        {flight.yieldDelta >= 0 ? '+' : ''}${flight.yieldDelta.toFixed(2)}
      </TableCell>
      <TableCell className="px-2">
        {getStatusBadge(flight.status)}
      </TableCell>
    </TableRow>
  );
});

type PresetFilter = 'All' | 'Top Matches' | 'Cheapest' | 'Shortest';

export function FlightDataTable() {
  const { flightResults, ticket } = useTicketStore();
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'yieldDelta', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [filterText, setFilterText] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [activePreset, setActivePreset] = useState<PresetFilter>('All');
  const pageIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setFilterText(inputValue);
      if (inputValue !== '' || activePreset !== 'All') {
        setCurrentPage(1);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [inputValue]);

  const filteredAndSortedFlights = useMemo(() => {
    let result = [...flightResults];

    if (activePreset === 'Top Matches') {
      result = result.filter(f => f.status === 'verified' || f.status === 'live');
      result.sort((a, b) => a.price - b.price);
      return result.slice(0, 3);
    }

    if (activePreset === 'Cheapest') {
      result.sort((a, b) => a.price - b.price);
      return result;
    }

    if (activePreset === 'Shortest') {
      result.sort((a, b) => a.nights - b.nights);
      return result;
    }

    if (filterText) {
      const lower = filterText.toLowerCase();
      const ignoreYear = lower.replace(/2026/g, '').trim();
      
      if (ignoreYear) {
        const exactMatch = ignoreYear.length <= 3 && /^[A-Z0-9]+$/i.test(ignoreYear);
        
        if (exactMatch) {
          result = result.filter(f =>
            f.carrier?.toUpperCase() === ignoreYear.toUpperCase() ||
            f.carrier?.toLowerCase().includes(lower)
          );
        } else {
          result = result.filter(f =>
            f.carrier?.toLowerCase().includes(lower) ||
            (f.departureDate || '').replace('2026-', '').includes(lower) ||
            (f.returnDate || '').replace('2026-', '').includes(lower) ||
            (f.fareBrand || '')?.toLowerCase().includes(lower) ||
            (f.metadata?.fareBrand || '')?.toLowerCase().includes(lower)
          );
        }
      }
    }

    result.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (sortConfig.key === 'fareBrand') {
        aVal = a.metadata?.fareBrand || a.fareBrand || '';
        bVal = b.metadata?.fareBrand || b.fareBrand || '';
      } else {
        aVal = (a as any)[sortConfig.key];
        bVal = (b as any)[sortConfig.key];
      }

      if (typeof aVal === 'string') {
        return sortConfig.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (aVal == null) return 1;
      if (bVal == null) return -1;

      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return result;
  }, [flightResults, sortConfig, filterText, activePreset]);

  const totalPages = Math.ceil(filteredAndSortedFlights.length / ROWS_PER_PAGE);
  const paginatedFlights = filteredAndSortedFlights.slice(
    (currentPage - 1) * ROWS_PER_PAGE,
    currentPage * ROWS_PER_PAGE
  );

  const handleSort = (key: string) => {
    setSortConfig(prev =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' }
    );
    setCurrentPage(1);
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey) return null;
    return sortConfig.direction === 'asc'
      ? <ChevronUp className="w-3 h-3 ml-1 inline" />
      : <ChevronDown className="w-3 h-3 ml-1 inline" />;
  };

  const getStatusColor = useCallback((yieldDelta: number) => {
    if (yieldDelta < -50) return 'text-emerald-400';
    if (yieldDelta < 0) return 'text-cyan-400';
    if (yieldDelta < 50) return 'text-orange-400';
    return 'text-red-400';
  }, []);

  const getStatusBadge = useCallback((status: string) => {
    const statusLower = status.toLowerCase();

    if (statusLower.includes('exact') || statusLower.includes('verified') || statusLower.includes('live')) {
      return (
        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
          VERIFIED
        </span>
      );
    }

    if (statusLower.includes('date') || statusLower.includes('flex')) {
      return (
        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-400 border border-orange-500/30">
          DATE FLEX
        </span>
      );
    }

    if (statusLower.includes('out_of_range')) {
      return (
        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30">
          OUT OF RANGE
        </span>
      );
    }

    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-500/20 text-slate-400 border border-slate-500/30">
        {status.toUpperCase()}
      </span>
    );
  }, []);

  const formatSegmentInfo = useCallback((flight: any) => {
    const segments = flight.metadata?.segments || 1;
    if (segments === 1) return 'Direct';
    return `${segments - 1} Stop${segments > 2 ? 's' : ''}`;
  }, []);

  const formatRoute = useCallback((flight: any) => {
    if (flight.outboundSegments?.length > 0) {
      const first = flight.outboundSegments[0];
      const last = flight.outboundSegments[flight.outboundSegments.length - 1];
      return `${first.origin} → ${last.destination}`;
    }
    return 'N/A';
  }, []);

  const formatOutboundDate = useCallback((flight: any) => {
    if (flight.outboundSegments?.length > 0) {
      const dep = flight.outboundSegments[0].departureTime;
      if (dep && typeof dep === 'string') {
        const [year, month, day] = dep.split('T')[0].split('-');
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${monthNames[parseInt(month) - 1]} ${parseInt(day)}`;
      }
      return '--';
    }
    return '--';
  }, []);

  const formatOutboundTime = useCallback((flight: any) => {
    if (flight.outboundSegments?.length > 0) {
      const first = flight.outboundSegments[0];
      const last = flight.outboundSegments[flight.outboundSegments.length - 1];
      const dep = first.departureTime;
      const arr = last.arrivalTime;
      const depTime = dep ? new Date(dep).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
      const arrTime = arr ? new Date(arr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
      return `${depTime}→${arrTime}`;
    }
    return '--:--→--:--';
  }, []);

  const formatInboundDate = useCallback((flight: any) => {
    const dep = flight.inboundSegments?.[0]?.departureTime;
    if (dep && typeof dep === 'string') {
      const [year, month, day] = dep.split('T')[0].split('-');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${monthNames[parseInt(month) - 1]} ${parseInt(day)}`;
    }
    return '--';
  }, []);

  const formatInboundTime = useCallback((flight: any) => {
    if (flight.inboundSegments?.length > 0) {
      const first = flight.inboundSegments[0];
      const last = flight.inboundSegments[flight.inboundSegments.length - 1];
      const dep = first.departureTime;
      const arr = last.arrivalTime;
      const depTime = dep ? new Date(dep).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
      const arrTime = arr ? new Date(arr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
      return `${depTime}→${arrTime}`;
    }
    return '--:--→--:--';
  }, []);

  const handleRowClick = useCallback((flight: any) => {
    setActiveCandidateId(prev => prev === flight.id ? null : flight.id);
  }, []);

  const startPaging = useCallback((direction: 'prev' | 'next') => {
    if (pageIntervalRef.current) return;
    
    const changePage = () => {
      setCurrentPage(p => {
        if (direction === 'prev') return Math.max(1, p - 1);
        return Math.min(totalPages, p + 1);
      });
    };
    
    changePage();
    pageIntervalRef.current = setInterval(changePage, 150);
  }, [totalPages]);

  const stopPaging = useCallback(() => {
    if (pageIntervalRef.current) {
      clearInterval(pageIntervalRef.current);
      pageIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => stopPaging();
  }, [stopPaging]);

  const verifiedCount = flightResults.filter(f => f.status === 'verified').length;
  const fareBrand = useCallback((flight: any) => flight.metadata?.fareBrand || flight.fareBrand || 'Standard', []);
  const carrierName = useCallback((code: string) => CARRIER_NAMES[code] || code, []);

  const selectedFlight = useMemo(() => {
    return flightResults.find(f => f.id === activeCandidateId) || null;
  }, [flightResults, activeCandidateId]);

  const topMatchIds = useMemo(() => {
    const verifiedFlights = flightResults.filter(f => f.status === 'verified');
    const sorted = [...verifiedFlights].sort((a, b) => a.price - b.price);
    const top3 = sorted.slice(0, 3);
    return new Set(top3.map(f => f.id));
  }, [flightResults]);

  return (
    <div className="border border-slate-800 rounded-sm bg-slate-900/50 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 text-[10px] font-bold rounded uppercase shrink-0">
          {filteredAndSortedFlights.length}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {(['All', 'Top Matches', 'Cheapest', 'Shortest'] as PresetFilter[]).map((preset) => (
            <button
              key={preset}
              onClick={() => { setActivePreset(preset); setCurrentPage(1); }}
              className={cn(
                'px-1.5 py-0.5 text-[8px] font-medium rounded border transition-colors',
                activePreset === preset
                  ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50'
                  : 'bg-slate-900/50 text-slate-500 border-slate-800 hover:border-slate-700'
              )}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-[120px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <Input
            placeholder="Search..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="pl-7 h-6 text-[10px] bg-slate-950 border-slate-800"
          />
          {inputValue && (
            <button
              onClick={() => { setInputValue(''); setFilterText(''); }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[350px] relative">
        <Table>
          <TableHeader className="sticky top-0 bg-slate-900 z-10">
            <TableRow className="border-b border-slate-800">
              <TableHead
                className="text-slate-500 font-medium text-[9px] uppercase cursor-pointer hover:text-slate-400 px-2"
                onClick={() => handleSort('carrier')}
              >
                Carrier<SortIcon columnKey="carrier" />
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase px-2">
                Out Date
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase px-2">
                Out Time
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase px-2">
                In Date
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase px-2">
                In Time
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase text-center px-2">Cabin</TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase px-2">Brand</TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase px-2">Class</TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase text-center px-2">Nights</TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase text-right cursor-pointer hover:text-slate-400 px-2" onClick={() => handleSort('price')}>
                Price<SortIcon columnKey="price" />
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase text-right cursor-pointer hover:text-slate-400 px-2" onClick={() => handleSort('price')}>
                Price<SortIcon columnKey="price" />
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase text-right cursor-pointer hover:text-slate-400 px-2" onClick={() => handleSort('yieldDelta')}>
                Yield<SortIcon columnKey="yieldDelta" />
              </TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase px-2">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedFlights.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={12} className="text-center text-slate-600 py-8">
                  <div className="flex flex-col items-center gap-2">
                    <Plane className="w-6 h-6 text-slate-700 animate-pulse" />
                    <span className="text-[10px] uppercase tracking-wider">
                      {filterText ? 'No matching results' : 'Awaiting Candidate Stream...'}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              paginatedFlights.map((flight, idx) => {
                const isOutOfRange = flight.status === 'out_of_range';
                const isActive = activeCandidateId === flight.id;
                const isTopMatch = topMatchIds.has(flight.id);
                return (
                  <MemoizedFlightRow
                    key={flight.id}
                    flight={flight}
                    idx={idx}
                    isOutOfRange={isOutOfRange}
                    isActive={isActive}
                    isTopMatch={isTopMatch}
                    onClick={() => handleRowClick(flight)}
                    fareBrand={fareBrand}
                    formatOutboundDate={formatOutboundDate}
                    formatOutboundTime={formatOutboundTime}
                    formatInboundDate={formatInboundDate}
                    formatInboundTime={formatInboundTime}
                    getStatusColor={getStatusColor}
                    getStatusBadge={getStatusBadge}
                  />
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="p-2 border-t border-slate-800 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            Page {currentPage}/{totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onMouseDown={() => startPaging('prev')}
              onMouseUp={stopPaging}
              onMouseLeave={stopPaging}
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="h-6 w-6 p-0"
            >
              <ChevronLeft className="w-3 h-3" />
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let page = i + 1;
              if (totalPages > 5) {
                if (currentPage > 3) page = currentPage - 2 + i;
                if (currentPage > totalPages - 2) page = totalPages - 4 + i;
              }
              return (
                <Button
                  key={page}
                  variant={currentPage === page ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setCurrentPage(page)}
                  className="h-6 w-6 p-0 text-[10px]"
                >
                  {page}
                </Button>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onMouseDown={() => startPaging('next')}
              onMouseUp={stopPaging}
              onMouseLeave={stopPaging}
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="h-6 w-6 p-0"
            >
              <ChevronRight className="w-3 h-3" />
            </Button>
          </div>
        </div>
      )}

      <Sheet open={!!selectedFlight} onOpenChange={() => setActiveCandidateId(null)}>
        <SheetContent className="w-full h-full max-h-[85vh] sm:max-w-md md:max-w-lg fixed bottom-0 sm:right-0 sm:top-0 z-50 overflow-y-auto bg-slate-900 border-t sm:border-l border-slate-800">
          {selectedFlight && (
            <div className="p-4 space-y-4 overflow-x-hidden">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
                <div className="p-2 bg-cyan-500/20 rounded shrink-0">
                  <Plane className="w-6 h-6 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-100 truncate">
                      {selectedFlight.carrier}
                    </h2>
                    <Badge
                      className={cn(
                        'text-xs shrink-0',
                        fareBrand(selectedFlight) === 'Light' && 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                        fareBrand(selectedFlight) === 'Flex' && 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                        fareBrand(selectedFlight) === 'Plus' && 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                        fareBrand(selectedFlight) === 'Standard' && 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                      )}
                    >
                      {fareBrand(selectedFlight)}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{carrierName(selectedFlight.carrier)}</p>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-sm overflow-hidden">
                <div className="px-3 py-2 bg-slate-900/50 border-b border-slate-800">
                  <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Comparison Matrix</p>
                </div>
                <div className="divide-y divide-slate-800 text-sm">
                  <div className="grid grid-cols-3 gap-2 px-3 py-2">
                    <span className="text-slate-500 text-xs">Attribute</span>
                    <span className="text-slate-400 text-xs text-center">Original</span>
                    <span className="text-slate-400 text-xs text-center">Offer</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 items-center">
                    <span className="text-slate-400 text-xs">Price</span>
                    <span className="text-slate-300 text-xs font-mono text-center truncate">${(ticket.baseCost || 792.87).toFixed(2)}</span>
                    <span className={cn('text-xs font-mono text-center font-semibold truncate', selectedFlight.yieldDelta < 0 ? 'text-emerald-400' : 'text-red-400')}>
                      ${selectedFlight.price.toFixed(2)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 items-center">
                    <span className="text-slate-400 text-xs">Fare Brand</span>
                    <span className="text-slate-300 text-xs font-mono text-center truncate">{ticket.fareClass || 'Economy'}</span>
                    <span className={cn('text-xs font-mono text-center truncate', fareBrand(selectedFlight) === 'Light' ? 'text-amber-400' : 'text-slate-300')}>
                      {fareBrand(selectedFlight)}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 items-center">
                    <span className="text-slate-400 text-xs">Routing</span>
                    <span className="text-slate-300 text-xs font-mono text-center truncate">CAI → ATH</span>
                    <span className="text-slate-300 text-xs font-mono text-center truncate">
                      {(selectedFlight as FlightWithSegments).outboundSegments?.[0]?.origin || 'N/A'} → {(selectedFlight as FlightWithSegments).outboundSegments?.[0]?.destination || 'N/A'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 items-center">
                    <span className="text-slate-400 text-xs">Baggage</span>
                    <span className="text-slate-300 text-xs font-mono text-center">1 PC</span>
                    <span className={cn('text-xs font-mono text-center truncate', selectedFlight.metadata?.baggage === '0 PC' ? 'text-red-400' : 'text-slate-300')}>
                      {selectedFlight.metadata?.baggage || '1 PC'}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 items-center">
                    <span className="text-slate-400 text-xs">Booking Class</span>
                    <span className="text-slate-300 text-xs font-mono text-center">{(ticket as any).bookingClass || 'Y'}</span>
                    <span className="text-slate-300 text-xs font-mono text-center">{selectedFlight.metadata?.bookingClass || 'Y'}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 items-center bg-slate-900/50">
                    <span className="text-slate-400 text-xs font-semibold">Yield Delta</span>
                    <span className="text-slate-500 text-xs text-center">—</span>
                    <span className={cn('text-xs font-mono text-center font-bold truncate', getStatusColor(selectedFlight.yieldDelta))}>
                      {selectedFlight.yieldDelta >= 0 ? '+' : ''}${selectedFlight.yieldDelta.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-950 border border-slate-800 rounded-sm p-3">
                  <p className="text-[10px] text-cyan-400 uppercase mb-1 font-semibold tracking-wider">Outbound</p>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-mono font-bold text-slate-100 truncate">
                      {formatOutboundTime(selectedFlight).split('→')[0]}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                    <span className="text-sm font-mono font-bold text-slate-100 truncate">
                      {formatOutboundTime(selectedFlight).split('→')[1]}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 truncate">
                    {(selectedFlight as FlightWithSegments).outboundSegments?.[0]?.origin || 'N/A'} → {(selectedFlight as FlightWithSegments).outboundSegments?.[0]?.destination || 'N/A'}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{formatOutboundDate(selectedFlight)}</p>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-sm p-3">
                  <p className="text-[10px] text-cyan-400 uppercase mb-1 font-semibold tracking-wider">Return</p>
                  <p className="text-sm font-mono font-bold text-slate-100 truncate">
                    {selectedFlight.returnDate}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">{selectedFlight.nights} nights</p>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-sm p-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Total</p>
                    <p className="text-lg font-bold text-slate-100 font-mono truncate">${selectedFlight.price.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">{selectedFlight.yieldDelta < 0 ? 'Savings' : 'Premium'}</p>
                    <p className={cn('text-lg font-bold font-mono truncate', selectedFlight.yieldDelta < 0 ? 'text-emerald-400' : 'text-red-400')}>
                      ${Math.abs(selectedFlight.yieldDelta).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Segments</p>
                    <p className="text-lg font-bold text-slate-300">{formatSegmentInfo(selectedFlight)}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-sm p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-xs text-slate-400 truncate">{selectedFlight.metadata?.phase || selectedFlight.status}</span>
                </div>
                {getStatusBadge(selectedFlight.status)}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
