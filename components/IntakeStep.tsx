'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useTicketStore } from '@/src/store/useTicketStore';
import { useTelemetryStore } from '@/src/store/useTelemetryStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, CircleCheck as CheckCircle2, Database, Plane, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

type ProcessingState = 'idle' | 'processing' | 'authenticated';
type IntakeMode = 'rebook' | 'fresh';

const PROCESSING_MESSAGES = [
  'ESTABLISHING GDS HANDSHAKE...',
  'RETRIEVING PNR METADATA...',
  'PARSING ITINERARY YIELDS...',
  'AUTHENTICATING IATA RULES...',
  'FINALIZING INTAKE BUFFER...',
];

export function IntakeStep({ onNext }: { onNext: () => void }) {
  const [processingState, setProcessingState] = useState<ProcessingState>('idle');
  const [progress, setProgress] = useState(0);
  const [processingMessage, setProcessingMessage] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('rebook');
  const { ticket, setTicket, isTicketValid, resetStore } = useTicketStore();
  const { addLog } = useTelemetryStore();

  const simulateProcessing = useCallback(() => {
    setProcessingState('processing');
    setProgress(0);
    setProcessingMessage(PROCESSING_MESSAGES[0]);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        return prev + 4;
      });
    }, 100);

    let messageIndex = 0;
    const messageInterval = setInterval(() => {
      messageIndex++;
      if (messageIndex < PROCESSING_MESSAGES.length) {
        setProcessingMessage(PROCESSING_MESSAGES[messageIndex]);
      } else {
        clearInterval(messageInterval);
      }
    }, 400);

    setTimeout(() => {
      clearInterval(progressInterval);
      clearInterval(messageInterval);
      setProcessingState('authenticated');
    }, 2500);
  }, []);

  const handlePDFUpload = useCallback(async (file: File) => {
    setIsParsing(true);
    simulateProcessing();

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    addLog({
      source: 'OPENROUTER',
      type: 'REQUEST',
      message: `Uploading PDF for parsing: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`,
      payload: { fileName: file.name, fileSize: file.size, fileType: file.type }
    });

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/parse-ticket', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const result = await response.json();
      const latency = Date.now() - startTime;

      if (!response.ok) {
        addLog({
          source: 'OPENROUTER',
          type: 'ERROR',
          message: result.error || 'PDF parsing failed',
          payload: result,
          latency,
          rawResponse: result.rawResponse
        });

        throw new Error(result.error || 'Failed to parse PDF');
      }

      addLog({
        source: 'OPENROUTER',
        type: 'RESPONSE',
        message: `PDF parsed successfully - PNR: ${result.data.pnr}`,
        payload: result,
        latency
      });

      setTicket({
        pnr: result.data.pnr,
        primaryPassengerLastName: result.data.primaryPassengerLastName,
        passengers: result.data.passengers,
        carrier: result.data.carrier || ticket.carrier,
        origin: result.data.origin || ticket.origin,
        destination: result.data.destination || ticket.destination,
        fareClass: result.data.fareClass,
        baseCost: result.data.baseCost,
        issueDate: new Date(result.data.issueDate),
        expirationDate: new Date(result.data.expirationDate),
        departureDate: result.data.departureDate ? new Date(result.data.departureDate) : null,
        passengerBreakdown: result.data.passengerBreakdown,
        rules: result.data.rules,
      });

      setIsParsing(false);
      setProcessingState('idle');
      toast.success('PDF parsed successfully');
      onNext();
    } catch (error) {
      clearTimeout(timeoutId);
      setProcessingState('idle');

      if (error instanceof Error && error.name === 'AbortError') {
        addLog({
          source: 'OPENROUTER',
          type: 'ERROR',
          message: 'Request Timed Out after 25s',
          payload: { timeout: 25000 }
        });
        toast.error('Request timed out - server may be unresponsive');
      } else {
        toast.error(error instanceof Error ? error.message : 'Failed to parse PDF');
      }
    } finally {
      setIsParsing(false);
    }
  }, [addLog, setTicket, onNext, simulateProcessing]);

  const handleGDSSync = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ticket.pnr || !ticket.primaryPassengerLastName) {
      toast.error('PNR and Last Name are required');
      return;
    }

    setIsParsing(true);
    simulateProcessing();

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    addLog({
      source: 'DUFFEL',
      type: 'REQUEST',
      message: `PNR Truth Engine: Fetching order ${ticket.pnr}`,
      payload: { pnr: ticket.pnr, lastName: ticket.primaryPassengerLastName }
    });

    try {
      const response = await fetch('/api/ingest-pnr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pnr: ticket.pnr,
          lastName: ticket.primaryPassengerLastName,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const result = await response.json();
      const latency = Date.now() - startTime;

      if (!response.ok) {
        addLog({
          source: 'DUFFEL',
          type: 'ERROR',
          message: result.error || 'PNR lookup failed',
          payload: result,
          latency,
        });

        throw new Error(result.error || 'Failed to fetch order from Duffel');
      }

      addLog({
        source: 'DUFFEL',
        type: 'RESPONSE',
        message: `PNR Truth Engine: Order fetched successfully`,
        payload: result,
        latency,
      });

      const ticketData = result.ticket;

      const mockIssueDate = new Date();
      mockIssueDate.setDate(mockIssueDate.getDate() - 30);
      const mockExpirationDate = new Date(mockIssueDate);
      mockExpirationDate.setFullYear(mockExpirationDate.getFullYear() + 1);

      setTicket({
        pnr: ticketData.pnr,
        primaryPassengerLastName: ticket.primaryPassengerLastName,
        passengers: [`${ticketData.rawOrderData?.passengers?.[0]?.given_name || 'PASSENGER'} ${ticketData.rawOrderData?.passengers?.[0]?.family_name || ''}`],
        carrier: ticketData.carrier || ticket.carrier,
        origin: ticketData.origin || ticket.origin,
        destination: ticketData.destination || ticket.destination,
        bookingClass: ticketData.bookingClass,
        fareClass: ticketData.rawOrderData?.cabinClass?.toUpperCase() || 'ECONOMY',
        baseCost: parseFloat(ticketData.rawOrderData?.totalAmount) || 0,
        issueDate: mockIssueDate,
        expirationDate: mockExpirationDate,
        departureDate: ticketData.departureDate ? new Date(ticketData.departureDate) : null,
        passengerBreakdown: {
          adults: ticketData.passengers?.adults || 1,
          children: ticketData.passengers?.children || 0,
          infants: ticketData.passengers?.infants || 0,
          passengerTypeSource: 'DUFFEL_ORDER_API',
        },
        rules: {
          validity: '12 months from issue',
          luggage: 'Check carrier policy',
          cancellation: ticketData.rawOrderData?.fareBrand || 'Subject to fare rules',
        },
      });

      console.log('[IntakeStep] Store state after PNR sync:', {
        pnr: ticketData.pnr,
        carrier: ticketData.carrier,
        origin: ticketData.origin,
        destination: ticketData.destination,
        bookingClass: ticketData.bookingClass,
      });

      setIsParsing(false);
      setProcessingState('authenticated');
      toast.success('PNR Truth Engine: Order authenticated via Duffel API');
      onNext();
    } catch (error) {
      clearTimeout(timeoutId);
      setProcessingState('idle');
      setIsParsing(false);

      if (error instanceof Error && error.name === 'AbortError') {
        addLog({
          source: 'DUFFEL',
          type: 'ERROR',
          message: 'Request Timed Out after 30s',
          payload: { timeout: 30000 }
        });
        toast.error('Request timed out - Duffel API may be unresponsive');
      } else {
        const errorMsg = error instanceof Error ? error.message : 'Failed to sync GDS record';
        addLog({
          source: 'DUFFEL',
          type: 'ERROR',
          message: errorMsg,
        });
        toast.error(errorMsg);
      }
    }
  };

  const handleFreshModeSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    const origin = ticket.origin?.trim().toUpperCase();
    const destination = ticket.destination?.trim().toUpperCase();
    const carrier = ticket.carrier?.trim().toUpperCase();

    if (!origin || origin.length !== 3) {
      toast.error('Origin must be a 3-letter IATA code');
      return;
    }
    if (!destination || destination.length !== 3) {
      toast.error('Destination must be a 3-letter IATA code');
      return;
    }
    if (!carrier || carrier.length !== 2) {
      toast.error('Carrier must be a 2-letter IATA code');
      return;
    }

    addLog({
      source: 'SYSTEM',
      type: 'REQUEST',
      message: `Fresh Mode: Route ${origin}-${destination} on ${carrier}`,
      payload: { origin, destination, carrier }
    });

    const mockIssueDate = new Date();
    mockIssueDate.setDate(mockIssueDate.getDate() - 30);
    const mockExpirationDate = new Date(mockIssueDate);
    mockExpirationDate.setFullYear(mockExpirationDate.getFullYear() + 1);

    setTicket({
      pnr: 'FRESH',
      primaryPassengerLastName: 'ANALYST',
      passengers: ['Adult Passenger'],
      carrier: carrier,
      origin: origin,
      destination: destination,
      bookingClass: 'Y',
      fareClass: 'ECONOMY',
      baseCost: 0,
      issueDate: mockIssueDate,
      expirationDate: mockExpirationDate,
      departureDate: null,
      passengerBreakdown: {
        adults: 1,
        children: 0,
        infants: 0,
        passengerTypeSource: 'FRESH_MODE',
      },
      rules: {
        validity: 'Manual entry',
        luggage: 'Check carrier policy',
        cancellation: 'Subject to fare rules',
      },
    });

    console.log('[IntakeStep] Store state after Fresh Mode:', {
      carrier,
      origin,
      destination,
    });

    setProcessingState('authenticated');
    toast.success(`Route ${origin}-${destination} on ${carrier} configured`);
    onNext();
  }, [ticket, setTicket, addLog, onNext]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      handlePDFUpload(acceptedFiles[0]);
    }
  }, [handlePDFUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    multiple: false,
    disabled: processingState === 'processing' || isParsing,
  });

  const handleClearBuffer = () => {
    resetStore();
    setProcessingState('idle');
    setIsParsing(false);
    toast.info('Buffer cleared');
  };

  const isAuthenticated = ticket.pnr && isTicketValid();

  if (processingState === 'processing' || isParsing) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex flex-col items-center justify-center min-h-[400px] space-y-6">
          <div className="w-full max-w-md space-y-4">
            <Progress value={progress} className="h-2" />
            <div className="text-center">
              <p className="text-xs font-mono text-emerald-400 animate-pulse">
                {isParsing && progress >= 100 ? 'INVOKING OPENROUTER LLM EXTRACTION...' : processingMessage}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (processingState === 'authenticated' && isAuthenticated) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-6 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span className="text-emerald-500 font-mono text-sm uppercase tracking-wide">
            INVENTORY AUTHENTICATED
          </span>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="border border-slate-800 p-4 bg-[#030712]">
            <div className="text-[10px] text-slate-500 font-mono uppercase mb-2">
              PNR LOCATOR
            </div>
            <div className="text-lg font-mono text-slate-100 font-bold">
              {ticket.pnr}
            </div>
          </div>

          <div className="border border-slate-800 p-4 bg-[#030712]">
            <div className="text-[10px] text-slate-500 font-mono uppercase mb-2">
              FARE YIELD
            </div>
            <div className="text-lg font-mono text-slate-100 font-bold">
              ${ticket.baseCost.toFixed(2)}
            </div>
          </div>

          <div className="border border-slate-800 p-4 bg-[#030712]">
            <div className="text-[10px] text-slate-500 font-mono uppercase mb-2">
              PASSENGERS
            </div>
            <div className="text-lg font-mono text-slate-100 font-bold">
              {ticket.passengers.length > 0 ? ticket.passengers.join(', ') : 'No passengers'}
            </div>
          </div>

          <div className="border border-slate-800 p-4 bg-[#030712]">
            <div className="text-[10px] text-slate-500 font-mono uppercase mb-2">
              IATA EXPIRY
            </div>
            <div className="text-lg font-mono text-slate-100 font-bold">
              {ticket.expirationDate && !isNaN(ticket.expirationDate.getTime())
                ? ticket.expirationDate.toISOString().split('T')[0]
                : 'N/A'}
            </div>
          </div>
        </div>

        {(ticket.rules.validity || ticket.rules.luggage || ticket.rules.cancellation) && (
          <div className="border border-slate-800 p-4 bg-slate-900/30 mb-6">
            <div className="text-[10px] text-slate-400 font-mono uppercase mb-3">
              FARE RULES
            </div>
            <div className="space-y-2 text-xs text-slate-300 font-mono">
              {ticket.rules.validity && (
                <div>
                  <span className="text-slate-500">VALIDITY:</span> {ticket.rules.validity}
                </div>
              )}
              {ticket.rules.luggage && (
                <div>
                  <span className="text-slate-500">LUGGAGE:</span> {ticket.rules.luggage}
                </div>
              )}
              {ticket.rules.cancellation && (
                <div>
                  <span className="text-slate-500">CANCELLATION:</span> {ticket.rules.cancellation}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button
            onClick={handleClearBuffer}
            variant="outline"
            disabled={isParsing}
            className="flex-1 bg-transparent border-slate-800 text-slate-400 hover:bg-slate-900 hover:text-slate-100"
          >
            CLEAR BUFFER
          </Button>
          <Button
            onClick={onNext}
            disabled={isParsing}
            className="flex-1 bg-cyan-600 text-white hover:bg-cyan-700 border-0"
          >
            PROCEED TO LOGIC
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-xs text-slate-400 uppercase mb-4 tracking-wide">
          SOURCE INTAKE BUFFER
        </h2>
      </div>

      <Tabs value={intakeMode} onValueChange={(v) => setIntakeMode(v as IntakeMode)} className="w-full">
        <TabsList className="grid w-full grid-cols-2 bg-slate-900 border border-slate-800 mb-6">
          <TabsTrigger value="rebook" className="text-xs uppercase tracking-wide data-[state=active]:bg-cyan-950 data-[state=active]:text-cyan-400">
            <RefreshCw className="w-3 h-3 mr-2" />
            Rebook Mode
          </TabsTrigger>
          <TabsTrigger value="fresh" className="text-xs uppercase tracking-wide data-[state=active]:bg-cyan-950 data-[state=active]:text-cyan-400">
            <Plane className="w-3 h-3 mr-2" />
            Fresh Mode
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rebook" className="space-y-4">
          <div className="grid grid-cols-2 gap-6">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed bg-transparent min-h-[250px] flex flex-col items-center justify-center cursor-pointer transition-colors ${
                isDragActive
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="w-12 h-12 text-slate-700 mb-4" />
              <span className="uppercase font-bold text-slate-600 text-sm tracking-wider">
                {isDragActive ? 'DROP FILE HERE' : 'DROP E-TICKET PDF'}
              </span>
              <span className="text-[10px] text-slate-700 mt-2">
                GDS INTEGRATION ACTIVE
              </span>
            </div>

            <div className="border border-slate-800 bg-transparent p-6 min-h-[250px] flex flex-col">
              <div className="text-xs text-center text-slate-500 uppercase mb-8 tracking-wide">
                MANUAL GDS LOOKUP
              </div>

              <form onSubmit={handleGDSSync} className="flex-1 flex flex-col">
                <div className="flex gap-4 mb-6">
                  <div className="flex-1">
                    <Label
                      htmlFor="pnr"
                      className="text-[10px] text-slate-500 uppercase mb-2 block font-mono"
                    >
                      LOCATOR (PNR)
                    </Label>
                    <Input
                      id="pnr"
                      value={ticket.pnr}
                      onChange={(e) =>
                        setTicket({ pnr: e.target.value.toUpperCase() })
                      }
                      placeholder="ABC123"
                      maxLength={6}
                      required
                      className="uppercase bg-transparent border-slate-800 text-slate-200 font-mono text-sm h-10"
                    />
                  </div>

                  <div className="flex-1">
                    <Label
                      htmlFor="primaryPassengerLastName"
                      className="text-[10px] text-slate-500 uppercase mb-2 block font-mono"
                    >
                      ANALYST SIGN
                    </Label>
                    <Input
                      id="primaryPassengerLastName"
                      value={ticket.primaryPassengerLastName}
                      onChange={(e) =>
                        setTicket({ primaryPassengerLastName: e.target.value.toUpperCase() })
                      }
                      placeholder="SMITH"
                      required
                      className="uppercase bg-transparent border-slate-800 text-slate-200 font-mono text-sm h-10"
                    />
                  </div>
                </div>

                <div className="mt-auto">
                  <Button
                    type="submit"
                    disabled={!ticket.pnr || !ticket.primaryPassengerLastName || isParsing}
                    className="w-full bg-[#0f172a] hover:bg-cyan-900 border border-cyan-500/30 text-cyan-400 h-11"
                  >
                    <Database className="w-4 h-4 mr-2" />
                    SYNC RECORD
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="fresh">
          <div className="border border-slate-800 bg-transparent p-6">
            <div className="text-xs text-center text-slate-500 uppercase mb-6 tracking-wide">
              FRESH ROUTE CONFIGURATION
            </div>
            <p className="text-[10px] text-slate-400 text-center mb-8">
              Enter route details for a fresh price sweep without existing ticket
            </p>

            <form onSubmit={handleFreshModeSubmit} className="max-w-md mx-auto space-y-6">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label
                    htmlFor="fresh-origin"
                    className="text-[10px] text-slate-500 uppercase mb-2 block font-mono"
                  >
                    Origin
                  </Label>
                  <Input
                    id="fresh-origin"
                    value={ticket.origin || ''}
                    onChange={(e) =>
                      setTicket({ origin: e.target.value.toUpperCase() })
                    }
                    placeholder="CAI"
                    maxLength={3}
                    required
                    className="uppercase bg-transparent border-slate-800 text-slate-200 font-mono text-sm h-10 text-center tracking-widest"
                  />
                </div>

                <div>
                  <Label
                    htmlFor="fresh-destination"
                    className="text-[10px] text-slate-500 uppercase mb-2 block font-mono"
                  >
                    Destination
                  </Label>
                  <Input
                    id="fresh-destination"
                    value={ticket.destination || ''}
                    onChange={(e) =>
                      setTicket({ destination: e.target.value.toUpperCase() })
                    }
                    placeholder="ATH"
                    maxLength={3}
                    required
                    className="uppercase bg-transparent border-slate-800 text-slate-200 font-mono text-sm h-10 text-center tracking-widest"
                  />
                </div>

                <div>
                  <Label
                    htmlFor="fresh-carrier"
                    className="text-[10px] text-slate-500 uppercase mb-2 block font-mono"
                  >
                    Carrier
                  </Label>
                  <Input
                    id="fresh-carrier"
                    value={ticket.carrier || ''}
                    onChange={(e) =>
                      setTicket({ carrier: e.target.value.toUpperCase() })
                    }
                    placeholder="A3"
                    maxLength={2}
                    required
                    className="uppercase bg-transparent border-slate-800 text-slate-200 font-mono text-sm h-10 text-center tracking-widest"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full bg-cyan-600 hover:bg-cyan-700 border-0 text-white h-11"
              >
                <Plane className="w-4 h-4 mr-2" />
                Configure Route
              </Button>
            </form>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
