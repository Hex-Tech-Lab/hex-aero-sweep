/**
 * OpenRouter LLM Service with Sequential Fallbacks
 * Handles T&C data extraction with automatic model fallback and telemetry preparation
 */

export interface ModelConfig {
  id: string;
  priority: number;
}

export interface ExtractionResult<T = any> {
  success: boolean;
  data: T | null;
  modelUsed: string;
  error?: string;
  rawResponse?: string;
  telemetry?: {
    latencyMs: number;
    timestamp: string;
    modelId: string;
    success: boolean;
  };
}

export interface TCExtractionSchema {
  pnr?: string;
  passengers?: string[];
  passengerCount?: number;
  primaryPassengerLastName?: string;
  carrierName?: string;
  ticketNumbers?: string[];
  departureAirport?: string;
  arrivalAirport?: string;
  departureDate?: string;
  arrivalDate?: string;
  returnFlightNumber?: string | null;
  returnDepartureDate?: string | null;
  isRoundTrip?: boolean;
  issueDate?: string;
  expirationDate?: string | null;
  flightNumber?: string;
  fareClass?: string;
  baseFare?: number;
  passengerBreakdown?: {
    adults?: number;
    children?: number;
    infants?: number;
    passengerTypeSource?: string;
  };
  baggage?: {
    checked?: string;
    carry?: string;
  };
  baggageAllowance?: string;
  baggagePromoDetails?: string;
  validity?: string;
  cancellationPolicy?: string;
  changePolicy?: string;
  refundEligibility?: string;
  additionalFees?: Array<{
    type: string;
    amount: string;
  }>;
}

const MODEL_PRIORITIES: ModelConfig[] = [
  { id: "anthropic/claude-3-5-haiku", priority: 1 },
  { id: "qwen/qwen-3-32b-instruct", priority: 2 },
  { id: "meta-llama/llama-3.1-8b-instruct", priority: 3 },
  { id: "liquid/lfm-2.5-1.2b-thinking:free", priority: 4 }
];

// TODO: Telemetry data collection for model performance tracking
// Will track: latency, success rates, token usage, error patterns
// Future: Dynamic reordering based on real-world performance metrics
interface ModelTelemetry {
  modelId: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgLatencyMs: number;
  lastUsed: string;
  successRate: number;
}

// Stub for future telemetry storage
class TelemetryCollector {
  private metrics: Map<string, ModelTelemetry> = new Map();

  async recordAttempt(modelId: string, latencyMs: number, success: boolean): Promise<void> {
    // TODO: Implement Supabase persistence for telemetry data
    // Table: model_telemetry (model_id, latency_ms, success, timestamp)
    const existing = this.metrics.get(modelId) || {
      modelId,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      avgLatencyMs: 0,
      lastUsed: new Date().toISOString(),
      successRate: 0
    };

    existing.totalCalls += 1;
    if (success) {
      existing.successfulCalls += 1;
    } else {
      existing.failedCalls += 1;
    }

    existing.avgLatencyMs = (existing.avgLatencyMs * (existing.totalCalls - 1) + latencyMs) / existing.totalCalls;
    existing.successRate = existing.successfulCalls / existing.totalCalls;
    existing.lastUsed = new Date().toISOString();

    this.metrics.set(modelId, existing);
  }

  async getOptimizedModelOrder(): Promise<ModelConfig[]> {
    // TODO: Reorder models based on success rate and latency
    // Algorithm: Sort by (successRate * 0.7) - (avgLatencyMs/1000 * 0.3)
    return MODEL_PRIORITIES;
  }
}

const telemetryCollector = new TelemetryCollector();

/**
 * Call OpenRouter API with specific model
 */
async function callOpenRouter(
  modelId: string,
  prompt: string,
  systemPrompt: string,
  timeoutMs: number = 30000
): Promise<any> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelWithNitro = modelId.includes(':nitro') ? modelId : `${modelId}:nitro`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
        "X-Title": "Hex Aero Sweep"
      },
      body: JSON.stringify({
        model: modelWithNitro,
        provider: {
          order: ["Nebius", "Parasail", "DeepInfra"],
          allow_fallbacks: true
        },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`OpenRouter API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    return result;
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error(`Model ${modelId} timed out after ${timeoutMs}ms`);
    }

    throw error;
  }
}

/**
 * Extract structured data from T&C text with sequential model fallback
 */
export async function extractTCData(
  tcText: string,
  schema?: Partial<TCExtractionSchema>
): Promise<ExtractionResult<TCExtractionSchema>> {
  const systemPrompt = `You are a meticulous aviation data parser. Your task is to extract structured information from airline ticket terms and conditions text and return STRICTLY VALID JSON.

CRITICAL EXTRACTION RULES:
1. PNR/Booking Reference: Extract the exact 6-character alphanumeric code. Search for labels "Booking Reference", "Locator", "Confirmation Code", or "PNR". Map this to the "pnr" key.
2. Passengers: Extract ALL passenger names as a JSON array (not singular). Include every name mentioned on the ticket.
3. Ticket Numbers: Extract ALL 13-digit ticket numbers as an array (not singular).
4. Primary Passenger Last Name: You must identify the Primary Passenger's last name. To find this, look at the "Contact" section, the first listed adult, or the passenger with Frequent Flyer miles assigned. The GDS lookup will fail if this is not the main booking contact. Extract ONLY the last name.
5. Airports: Use 3-letter IATA codes only.
6. Dates: Use ISO 8601 format (YYYY-MM-DD or full timestamp).
7. Round Trip Detection: Identify if a return flight exists and extract its details (returnFlightNumber, returnDepartureDate). Set isRoundTrip to true if present.
8. Baggage Promos: Extract any mention of luggage discounts or time-sensitive promos (e.g., "50% off within 24h", "pre-purchase", "early bird bonus bags") in the baggagePromoDetails field.
9. PASSENGER AGE VERIFICATION (HARD RULE):
   - DO NOT use external knowledge or names (e.g., Lara, Maya) to guess age categories.
   - Search ONLY for explicit age markers in the document:
     * SSR codes: CHLD, INFT, or similar child/infant service requests
     * Fare basis suffixes: /CH, /IN, /C15, /I99, etc.
     * Type columns: "CHILD", "INFANT", "ADULT" labels
     * Age ranges in text: "2-11" (child), "under 2" (infant)
   - If NO age-specific marker exists in the text, you MUST return all passengers as 'Adults'.
   - The 'passengerTypeSource' field MUST contain the EXACT substring from the PDF that confirms the age category (e.g., "TNN/CH", "SSR CHLD", "Type: CHILD").
   - If no marker is found, the field MUST say 'NO_MARKER_FOUND'.
   - Never guess or assume ages from passenger names.

Return a JSON object with these fields:
{
  "pnr": "string (6-char Booking Reference/Locator/PNR)",
  "passengers": ["string (Array of ALL passenger names)"],
  "passengerCount": number,
  "primaryPassengerLastName": "string (Last name only of primary contact)",
  "ticketNumbers": ["string (Array of all 13-digit numbers)"],
  "carrierName": "string",
  "departureAirport": "string (IATA)",
  "arrivalAirport": "string (IATA)",
  "departureDate": "string (ISO format)",
  "arrivalDate": "string (ISO format)",
  "returnFlightNumber": "string or null (flight number of return leg)",
  "returnDepartureDate": "string or null (ISO format of return date)",
  "isRoundTrip": "boolean (true if return flight exists)",
  "flightNumber": "string",
  "fareClass": "string",
  "baseFare": number,
  "baggage": {"checked": "string", "carry": "string"},
  "baggagePromoDetails": "string (any promo offers for baggage, e.g., '50% off within 24h')",
  "passengerBreakdown": {"adults": number, "children": number, "infants": number, "passengerTypeSource": "string (EXACT text marker or 'NO_MARKER_FOUND')"},
  "cancellationPolicy": "string",
  "changePolicy": "string"
}

MANDATORY: Output ONLY valid JSON. Do not wrap in markdown. Do not infer data not explicitly present.`;

  const userPrompt = `Extract all available information from this airline ticket terms and conditions text:\n\n${tcText}`;

  // Get potentially optimized model order (future: based on telemetry)
  const modelOrder = await telemetryCollector.getOptimizedModelOrder();

  let lastError: Error | null = null;

  // Sequential fallback through model priority list
  for (const modelConfig of modelOrder) {
    const startTime = Date.now();

    try {
      console.log(`Attempting extraction with model: ${modelConfig.id} (priority ${modelConfig.priority})`);

      const response = await callOpenRouter(
        modelConfig.id,
        userPrompt,
        systemPrompt,
        30000 // 30 second timeout per model
      );

      const latencyMs = Date.now() - startTime;

      // Parse the response
      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Empty response from model");
      }

      let extractedData: TCExtractionSchema;
      try {
        const cleanText = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        extractedData = JSON.parse(cleanText);
        
        // Ensure expirationDate is valid or calculate fallback
        if (!extractedData.expirationDate) {
          // If expirationDate is missing, set it to 365 days after the departureDate
          if (extractedData.departureDate) {
            const departureDate = new Date(extractedData.departureDate);
            if (!isNaN(departureDate.getTime())) {
              const expirationDate = new Date(departureDate);
              expirationDate.setDate(expirationDate.getDate() + 365);
              extractedData.expirationDate = expirationDate.toISOString().split('T')[0];
            }
          }
        } else {
          // Validate the date
          const date = new Date(extractedData.expirationDate);
          if (isNaN(date.getTime())) {
            extractedData.expirationDate = null;
          }
        }

        // VERIFY PASSENGER BREAKDOWN against passengerTypeSource
        // This ensures child passengers are correctly identified for discount capture
        if (extractedData.passengerBreakdown) {
          const source = extractedData.passengerBreakdown.passengerTypeSource;
          
          // Check if source explicitly confirms child passengers (CH indicator)
          if (source && (source.toUpperCase().includes('CH') || source.toLowerCase().includes('child'))) {
            // Verify children count is set
            if (!extractedData.passengerBreakdown.children || extractedData.passengerBreakdown.children === 0) {
              // Source confirmed CH but no children listed - flag for review
              console.warn('[OpenRouter] PASSENGER VERIFICATION: Source confirms CH but children count is 0 - flagged for manual review');
              
              // Attempt to infer from total passenger count vs adults
              const totalPassengers = extractedData.passengers?.length || extractedData.passengerCount || 0;
              const adults = extractedData.passengerBreakdown.adults || 0;
              if (totalPassengers > adults && totalPassengers > 0) {
                // Infer child passengers
                extractedData.passengerBreakdown.children = totalPassengers - adults;
                console.log(`[OpenRouter] PASSENGER VERIFICATION: Inferred ${extractedData.passengerBreakdown.children} child passenger(s) from passenger count`);
              }
            }
            
            // Ensure passengerTypeSource is set for downstream processing
            if (!extractedData.passengerBreakdown.passengerTypeSource) {
              extractedData.passengerBreakdown.passengerTypeSource = source;
            }
            
            console.log(`[OpenRouter] PASSENGER VERIFICATION: Child passenger source confirmed: "${source}" - ${extractedData.passengerBreakdown.children} child(ren) identified for discount capture`);
          } else if (source && source.toLowerCase().includes('unknown')) {
            // Source indicates unknown passenger types - warn but don't override
            console.warn('[OpenRouter] PASSENGER VERIFICATION: passengerTypeSource marked as unknown - adult pricing may apply');
          }
        }
      } catch (parseError) {
        const errorMsg = `Invalid JSON response from ${modelConfig.id}`;
        await telemetryCollector.recordAttempt(modelConfig.id, latencyMs, false);

        return {
          success: false,
          data: null,
          modelUsed: modelConfig.id,
          error: errorMsg,
          rawResponse: content,
          telemetry: {
            latencyMs,
            timestamp: new Date().toISOString(),
            modelId: modelConfig.id,
            success: false,
          },
        };
      }

      // Record successful telemetry
      await telemetryCollector.recordAttempt(modelConfig.id, latencyMs, true);

      // Return successful extraction
      return {
        success: true,
        data: extractedData,
        modelUsed: modelConfig.id,
        rawResponse: content,
        telemetry: {
          latencyMs,
          timestamp: new Date().toISOString(),
          modelId: modelConfig.id,
          success: true
        }
      };

    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      lastError = error;

      // Record failed telemetry
      await telemetryCollector.recordAttempt(modelConfig.id, latencyMs, false);

      console.error(`Model ${modelConfig.id} failed:`, error.message);

      // Continue to next model in fallback sequence
      if (modelConfig.priority < modelOrder.length) {
        console.log(`Falling back to next model...`);
        continue;
      }
    }
  }

  // All models failed
  return {
    success: false,
    data: null,
    modelUsed: "none",
    error: `All models failed. Last error: ${lastError?.message || "Unknown error"}`,
    telemetry: {
      latencyMs: 0,
      timestamp: new Date().toISOString(),
      modelId: "all-failed",
      success: false
    }
  };
}

/**
 * Health check for OpenRouter service
 */
export async function healthCheck(): Promise<{ healthy: boolean; message: string }> {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return { healthy: false, message: "OPENROUTER_API_KEY not configured" };
    }

    // Simple test with the fastest free model
    const response = await callOpenRouter(
      "liquid/lfm-2.5-1.2b-thinking:free",
      "Respond with: OK",
      "You are a test assistant. Respond exactly as instructed.",
      5000
    );

    return { healthy: true, message: "OpenRouter service is operational" };
  } catch (error: any) {
    return { healthy: false, message: error.message };
  }
}
