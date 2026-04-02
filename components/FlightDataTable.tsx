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
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
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
        <span className="text-[10px] font-mono text-slate-400">
          {flight.nights}N
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

export function FlightDataTable() {
  const { flightResults, ticket } = useTicketStore();
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'yieldDelta', direction: 'asc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [filterText, setFilterText] = useState('');
  const [isPaging, setIsPaging] = useState(false);
  const pageIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const filteredAndSortedFlights = useMemo(() => {
    let result = [...flightResults];

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
  }, [flightResults, sortConfig, filterText]);

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
      return dep ? new Date(dep).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '--';
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
    if (dep) {
      return new Date(dep).toLocaleDateString([], { month: 'short', day: 'numeric' });
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
    setActiveCandidateId(activeCandidateId === flight.id ? null : flight.id);
  }, [activeCandidateId]);

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

  const ComparisonTable = ({ offer }: { offer: any }) => {
    const original = ticket;
    const offerData = {
      price: offer.price,
      fareClass: offer.metadata?.fareBrand || offer.fareBrand || 'Standard',
      origin: offer.outboundSegments?.[0]?.origin || 'N/A',
      destination: offer.outboundSegments?.[0]?.destination || 'N/A',
      nights: offer.nights,
    };

    const comparisonRows = [
      { label: 'Price', original: `$${original.baseCost?.toFixed(2) || '792.87'}`, offer: `$${offerData.price.toFixed(2)}`, diff: offer.yieldDelta },
      { label: 'Fare Brand', original: original.fareClass || 'Economy', offer: offerData.fareClass, diff: null },
      { label: 'Route', original: 'CAI → ATH', offer: `${offerData.origin} → ${offerData.destination}`, diff: null },
      { label: 'Duration', original: 'Flexible', offer: `${offerData.nights} nights`, diff: null },
    ];

    return (
      <div className="mt-6 p-4 bg-slate-900 border border-slate-700 rounded-sm">
        <p className="text-xs text-cyan-400 uppercase mb-3 font-semibold tracking-wider">Ticket Comparison</p>
        <Table>
          <TableHeader>
            <TableRow className="border-slate-700">
              <TableHead className="text-slate-400 text-xs">Attribute</TableHead>
              <TableHead className="text-slate-400 text-xs text-center">Original Ticket</TableHead>
              <TableHead className="text-slate-400 text-xs text-center">Provider Offer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparisonRows.map((row) => (
              <TableRow key={row.label} className="border-slate-800">
                <TableCell className="text-slate-300 text-sm font-medium">{row.label}</TableCell>
                <TableCell className="text-center text-slate-400 text-sm font-mono">{row.original}</TableCell>
                <TableCell className="text-center text-sm">
                  <span className={cn('font-mono', row.diff !== null && (row.diff < 0 ? 'text-emerald-400' : 'text-red-400'))}>
                    {row.offer}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const DetailedComparison = () => {
    const sf = selectedFlight as FlightWithSegments | null;
    return (
    <pre className="mt-4 p-4 bg-black border border-slate-700 rounded text-[10px] font-mono text-slate-400 overflow-x-auto">
{`╔══════════════════════════════════════════════════════════════════════════════╗
║                         TICKET PARAMETER COMPARISON                            ║
╠════════════════════════════╦══════════════════════════╦═════════════════════════╣
║ PARAMETER                  ║ ORIGINAL TICKET          ║ NEW OFFER               ║
╠════════════════════════════╬══════════════════════════╬═════════════════════════╣
║ Ticket Number              ║ ${(ticket as any).ticketNumber || 'N/A'.padEnd(24)}║ ${sf?.carrier || 'N/A'.padEnd(25)}║
║ Route                      ║ CAI → ATH                ║ ${sf?.outboundSegments?.[0]?.origin || 'N/A'} → ${sf?.outboundSegments?.[0]?.destination || 'N/A'.padEnd(18)}║
║ Departure Date             ║ ${(ticket as any).departureDate || 'N/A'.padEnd(24)}║ ${(sf?.departureDate || 'N/A').padEnd(25)}║
║ Return Date                ║ ${(ticket as any).returnDate || 'N/A'.padEnd(24)}║ ${(sf?.returnDate || 'N/A').padEnd(25)}║
║ Base Fare                  ║ $${(ticket.baseCost || 792.87).toFixed(2).padEnd(22)}║ $${(sf?.price || 0).toFixed(2).padEnd(24)}║
║ Fare Brand                 ║ ${(ticket.fareClass || 'Economy').padEnd(24)}║ ${(fareBrand(sf as any) || 'Standard').padEnd(25)}║
║ Passenger Count            ║ ${(ticket.passengers?.length || 1).toString().padEnd(24)}║ ${(ticket.passengers?.length || 1).toString().padEnd(25)}║
║ Booking Class              ║ ${((ticket as any).bookingClass || 'Y').padEnd(24)}║ ${(sf?.metadata?.bookingClass || 'Y').padEnd(25)}║
║ Direct Flight Only         ║ ${((ticket as any).directFlightOnly ? 'Yes' : 'No').padEnd(24)}║ ${(sf?.metadata?.segments === 1 ? 'Yes' : 'No').padEnd(25)}║
╠════════════════════════════╬══════════════════════════╬═════════════════════════╣
║ YIELD DELTA                ║                          ║ $${(sf?.yieldDelta || 0) >= 0 ? '+' : ''}${(sf?.yieldDelta || 0).toFixed(2).padEnd(22)}║
╚════════════════════════════╩══════════════════════════╩═════════════════════════╝`}
    </pre>
  );
};

  return (
    <div className="border border-slate-800 rounded-sm bg-slate-900/50 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <span className="px-1.5 py-0.5 bg-cyan-500/20 text-cyan-400 text-[10px] font-bold rounded uppercase">
          Candidates {verifiedCount}
        </span>
        <div className="relative flex-1 max-w-[140px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <Input
            placeholder="Filter..."
            value={filterText}
            onChange={(e) => { setFilterText(e.target.value); setCurrentPage(1); }}
            className="pl-7 h-6 text-[10px] bg-slate-950 border-slate-800"
          />
          {filterText && (
            <button
              onClick={() => setFilterText('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <span className="text-[10px] text-slate-500 shrink-0">
          {filteredAndSortedFlights.length}
        </span>
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
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase text-center px-2">Nights</TableHead>
              <TableHead className="text-slate-500 font-medium text-[9px] uppercase cursor-pointer hover:text-slate-400 px-2" onClick={() => handleSort('fareBrand')}>
                Brand<SortIcon columnKey="fareBrand" />
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
                <TableCell colSpan={10} className="text-center text-slate-600 py-8">
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
        <SheetContent className="fixed right-0 top-0 h-full w-[800px] shadow-2xl bg-slate-950 border-l border-slate-800 z-50 overflow-y-auto">
          {selectedFlight && (
            <>
              <div className="pb-4 border-b border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-cyan-500/20 rounded">
                    <Plane className="w-8 h-8 text-cyan-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-bold text-slate-100">
                        {selectedFlight.carrier}
                      </h2>
                      <span className="text-xs text-slate-500">{carrierName(selectedFlight.carrier)}</span>
                      <Badge
                        className={cn(
                          'text-sm',
                          fareBrand(selectedFlight) === 'Light' && 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                          fareBrand(selectedFlight) === 'Flex' && 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                          fareBrand(selectedFlight) === 'Plus' && 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                          fareBrand(selectedFlight) === 'Standard' && 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                        )}
                      >
                        {fareBrand(selectedFlight)}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-500 uppercase tracking-wide mt-1">
                      Rebooking Candidate
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-[10px] text-cyan-400 uppercase mb-2 font-semibold tracking-wider">Outbound</p>
                  <div className="flex items-center gap-2">
                    <div className="text-center">
                      <p className="text-lg font-bold text-slate-100 font-mono">
                        {formatOutboundTime(selectedFlight).split('→')[0]}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {(selectedFlight as FlightWithSegments).outboundSegments?.[0]?.origin || 'N/A'}
                      </p>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                      <ArrowRight className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-slate-100 font-mono">
                        {formatOutboundTime(selectedFlight).split('→')[1]}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {(selectedFlight as FlightWithSegments).outboundSegments?.[0]?.destination || 'N/A'}
                      </p>
                    </div>
                  </div>
                  <p className="text-center text-xs text-slate-400 mt-2">
                    {formatOutboundDate(selectedFlight)}
                  </p>
                </div>

                <div className="p-3 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-[10px] text-cyan-400 uppercase mb-2 font-semibold tracking-wider">Return</p>
                  <div className="text-center py-2">
                    <p className="text-lg font-bold text-slate-100 font-mono">
                      {selectedFlight.returnDate}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-1">
                      {selectedFlight.nights} nights
                    </p>
                  </div>
                </div>

                <div className="col-span-2 p-3 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-[10px] text-slate-500 uppercase mb-2 font-semibold tracking-wider">Pricing</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Total</p>
                      <p className="text-2xl font-bold text-slate-100 font-mono">
                        ${selectedFlight.price.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Delta</p>
                      <p className={cn('text-2xl font-bold font-mono', getStatusColor(selectedFlight.yieldDelta))}>
                        {selectedFlight.yieldDelta >= 0 ? '+' : ''}${selectedFlight.yieldDelta.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">
                        {selectedFlight.yieldDelta < 0 ? 'Savings' : 'Premium'}
                      </p>
                      <p className={cn('text-xl font-bold font-mono', selectedFlight.yieldDelta < 0 ? 'text-emerald-400' : 'text-red-400')}>
                        ${Math.abs(selectedFlight.yieldDelta).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="col-span-2 p-3 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-[10px] text-slate-500 uppercase mb-2 font-semibold tracking-wider">Details</p>
                  <div className="grid grid-cols-4 gap-2 text-[10px]">
                    <div>
                      <span className="text-slate-500">Segments:</span>
                      <span className="ml-1 text-slate-300">{formatSegmentInfo(selectedFlight)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Class:</span>
                      <span className="ml-1 text-slate-300 font-mono">{selectedFlight.metadata?.bookingClass || 'Y'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Aircraft:</span>
                      <span className="ml-1 text-slate-300">{selectedFlight.metadata?.aircraft || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Baggage:</span>
                      <span className="ml-1 text-slate-300">{selectedFlight.metadata?.baggage || '1 PC'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Terminal:</span>
                      <span className="ml-1 text-slate-300">{(selectedFlight as FlightWithSegments).outboundSegments?.[0]?.terminal || 'T1'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Duration:</span>
                      <span className="ml-1 text-slate-300">{selectedFlight.nights}N</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Status:</span>
                      <span className="ml-1">{getStatusBadge(selectedFlight.status)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Provider:</span>
                      <span className="ml-1 text-slate-300">Provider 1</span>
                    </div>
                  </div>
                </div>

                <div className="col-span-2 p-3 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-[10px] text-slate-500 uppercase mb-2 font-semibold tracking-wider">Segment Details</p>
                  {((selectedFlight as FlightWithSegments).outboundSegments || []).map((seg: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-slate-800 last:border-0">
                      <span className="text-cyan-400 font-mono w-6">{seg.origin}</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-cyan-400 font-mono w-6">{seg.destination}</span>
                      <span className="text-slate-500 ml-2">{new Date(seg.departureTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="text-slate-600">→</span>
                      <span className="text-slate-500">{new Date(seg.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="ml-auto text-slate-400">{seg.terminal ? `T${seg.terminal}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>

              <ComparisonTable offer={selectedFlight} />
              <DetailedComparison />

              <div className="mt-4 p-3 bg-slate-900 border border-slate-800 rounded-sm">
                <p className="text-[10px] text-slate-500 uppercase mb-2 font-semibold tracking-wider">Discovery</p>
                <Badge variant="outline" className="uppercase text-xs">
                  <Clock className="w-3 h-3 mr-2" />
                  {selectedFlight.metadata?.phase || selectedFlight.status}
                </Badge>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
