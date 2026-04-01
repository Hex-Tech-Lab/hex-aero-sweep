'use client';

import { useState } from 'react';
import { useTicketStore } from '@/src/store/useTicketStore';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Plane, Clock, ArrowRight } from 'lucide-react';

export function FlightDataTable() {
  const { flightResults } = useTicketStore();
  const [selectedFlight, setSelectedFlight] = useState<any | null>(null);

  const sortedFlights = [...flightResults].sort((a, b) => a.yieldDelta - b.yieldDelta);

  const getStatusColor = (yieldDelta: number) => {
    if (yieldDelta < -50) return 'text-emerald-400';
    if (yieldDelta < 0) return 'text-cyan-400';
    if (yieldDelta < 50) return 'text-orange-400';
    return 'text-red-400';
  };

  const getStatusBadge = (status: string) => {
    const statusLower = status.toLowerCase();

    if (statusLower.includes('exact') || statusLower.includes('verified') || statusLower.includes('live')) {
      return (
        <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
          LIVE DUFFEL
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

    return (
      <span className="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-slate-500/20 text-slate-400 border border-slate-500/30">
        {status.toUpperCase()}
      </span>
    );
  };

  const formatSegmentInfo = (flight: any) => {
    const segments = flight.metadata?.segments || 1;
    if (segments === 1) return 'Direct';
    return `${segments - 1} Stop${segments > 2 ? 's' : ''}`;
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="border border-slate-800 rounded-sm bg-slate-900/50 overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-800 hover:bg-transparent bg-slate-900">
                <TableHead className="text-slate-400 font-semibold text-xs uppercase">Carrier</TableHead>
                <TableHead className="text-slate-400 font-semibold text-xs uppercase">Outbound</TableHead>
                <TableHead className="text-slate-400 font-semibold text-xs uppercase">Inbound</TableHead>
                <TableHead className="text-slate-400 font-semibold text-xs uppercase text-center">Duration</TableHead>
                <TableHead className="text-slate-400 font-semibold text-xs uppercase">Route</TableHead>
                <TableHead className="text-slate-400 font-semibold text-xs uppercase text-right">Price</TableHead>
                <TableHead className="text-slate-400 font-semibold text-xs uppercase text-right">Yield Δ</TableHead>
                <TableHead className="text-slate-400 font-semibold text-xs uppercase">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedFlights.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="text-center text-slate-600 py-12">
                    <div className="flex flex-col items-center gap-2">
                      <Plane className="w-8 h-8 text-slate-700 animate-pulse" />
                      <span className="text-xs uppercase tracking-wider">Awaiting Candidate Stream...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                sortedFlights.map((flight, index) => (
                  <Tooltip key={flight.id}>
                    <TooltipTrigger asChild>
                      <TableRow
                        onClick={() => setSelectedFlight(flight)}
                        className={cn(
                          'cursor-pointer hover:bg-slate-800/70 transition-colors border-b border-slate-800/50',
                          index % 2 === 0 ? 'bg-slate-900/30' : 'bg-slate-900/60'
                        )}
                      >
                        <TableCell className="font-mono font-semibold text-slate-100">
                          {flight.carrier}
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">
                          {flight.departureDate}
                        </TableCell>
                        <TableCell className="text-slate-300 text-sm">
                          {flight.returnDate}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs font-mono">
                            {flight.nights}N
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs">
                          {formatSegmentInfo(flight)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-slate-100">
                          ${flight.price.toFixed(2)}
                        </TableCell>
                        <TableCell
                          className={cn('text-right font-mono font-bold text-sm', getStatusColor(flight.yieldDelta))}
                        >
                          {flight.yieldDelta >= 0 ? '+' : ''}
                          ${flight.yieldDelta.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(flight.status)}
                        </TableCell>
                      </TableRow>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="bg-slate-900 border-slate-700 max-w-sm">
                      <div className="space-y-2 text-xs">
                        <div className="font-semibold text-slate-100 border-b border-slate-700 pb-1">
                          {flight.carrier} Flight Details
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-slate-300">
                          <div>
                            <span className="text-slate-500">Booking Class:</span>
                            <span className="ml-1 font-mono">{flight.metadata?.bookingClass || 'Y'}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">Segments:</span>
                            <span className="ml-1">{flight.metadata?.segments || 1}</span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-slate-500">Phase:</span>
                            <span className="ml-1 font-semibold text-cyan-400">
                              {flight.metadata?.phase || flight.status}
                            </span>
                          </div>
                        </div>
                        <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-800">
                          Click row for full details
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Sheet open={!!selectedFlight} onOpenChange={() => setSelectedFlight(null)}>
        <SheetContent className="bg-slate-950 border-slate-800 w-[500px] overflow-y-auto">
          {selectedFlight && (
            <>
              <SheetHeader>
                <SheetTitle className="text-slate-100 flex items-center gap-2">
                  <Plane className="w-5 h-5 text-cyan-400" />
                  Flight Details: {selectedFlight.carrier}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-xs text-slate-500 uppercase mb-3">Trip Dates</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500">Outbound</p>
                      <p className="text-lg font-semibold text-slate-100 font-mono">
                        {selectedFlight.departureDate}
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-600" />
                    <div className="text-right">
                      <p className="text-xs text-slate-500">Inbound</p>
                      <p className="text-lg font-semibold text-slate-100 font-mono">
                        {selectedFlight.returnDate}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-xs text-slate-500 uppercase mb-3">Pricing Analysis</p>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 text-sm">Total Price:</span>
                      <span className="font-mono font-bold text-slate-100 text-lg">
                        ${selectedFlight.price.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-300 text-sm">Yield Delta:</span>
                      <span
                        className={cn(
                          'font-mono font-bold text-lg',
                          getStatusColor(selectedFlight.yieldDelta)
                        )}
                      >
                        {selectedFlight.yieldDelta >= 0 ? '+' : ''}
                        ${selectedFlight.yieldDelta.toFixed(2)}
                      </span>
                    </div>
                    {selectedFlight.yieldDelta < 0 && (
                      <div className="mt-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded text-xs text-emerald-400">
                        <strong>Savings Opportunity:</strong> This option is ${Math.abs(selectedFlight.yieldDelta).toFixed(2)} cheaper than the original fare.
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-xs text-slate-500 uppercase mb-3">Trip Details</p>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-300 text-sm">Duration:</span>
                      <span className="text-slate-100 font-semibold">{selectedFlight.nights} nights</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300 text-sm">Segments:</span>
                      <span className="text-slate-100">{selectedFlight.metadata?.segments || 1}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300 text-sm">Route Type:</span>
                      <span className="text-slate-100">{formatSegmentInfo(selectedFlight)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-300 text-sm">Booking Class:</span>
                      <span className="text-slate-100 font-mono font-semibold">
                        {selectedFlight.metadata?.bookingClass || 'Y'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-900 border border-slate-800 rounded-sm">
                  <p className="text-xs text-slate-500 uppercase mb-3">Discovery Phase</p>
                  <Badge variant="outline" className="uppercase text-sm">
                    <Clock className="w-3 h-3 mr-2" />
                    {selectedFlight.metadata?.phase || selectedFlight.status}
                  </Badge>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
