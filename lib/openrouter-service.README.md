# OpenRouter LLM Service

Enterprise-grade T&C data extraction service with sequential model fallbacks and telemetry preparation.

## Features

- **Sequential Fallback**: Automatically tries 4 models in priority order
- **Timeout Protection**: 30-second timeout per model attempt
- **Telemetry Ready**: Prepared for performance tracking and dynamic reordering
- **Type-Safe**: Fully typed with TypeScript
- **Error Recovery**: Graceful degradation through model priority list

## Model Priority Order

1. `openai/gpt-oss-20b:nitro` (Priority 1) - Primary model
2. `qwen/qwen-3-32b-instruct` (Priority 2) - First fallback
3. `meta-llama/llama-3.1-8b-instruct` (Priority 3) - Second fallback
4. `liquid/lfm-2.5-1.2b-thinking:free` (Priority 4) - Final fallback

## API Endpoint

### POST /api/extract-tc

Extract structured data from T&C text.

**Request:**
```json
{
  "tcText": "Your airline ticket terms and conditions text..."
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "carrierName": "United Airlines",
    "ticketNumber": "UA123456",
    "passengerName": "John Doe",
    "departureAirport": "LAX",
    "arrivalAirport": "JFK",
    "departureDate": "2026-04-15T10:30:00Z",
    "arrivalDate": "2026-04-15T18:45:00Z",
    "flightNumber": "UA1234",
    "fareClass": "Economy",
    "baggage": {
      "checked": "2 bags up to 50lbs",
      "carry": "1 bag + 1 personal item"
    },
    "cancellationPolicy": "24-hour free cancellation",
    "changePolicy": "$200 change fee",
    "refundEligibility": "Non-refundable",
    "additionalFees": [
      { "type": "Seat Selection", "amount": "$25" }
    ]
  },
  "modelUsed": "openai/gpt-oss-20b:nitro",
  "telemetry": {
    "latencyMs": 1234,
    "timestamp": "2026-03-31T17:30:00Z",
    "modelId": "openai/gpt-oss-20b:nitro",
    "success": true
  }
}
```

**Response (Failure):**
```json
{
  "error": "All models failed. Last error: Model timeout",
  "modelUsed": "none",
  "telemetry": {
    "latencyMs": 0,
    "timestamp": "2026-03-31T17:30:00Z",
    "modelId": "all-failed",
    "success": false
  }
}
```

### GET /api/extract-tc

Health check endpoint.

**Response:**
```json
{
  "healthy": true,
  "message": "OpenRouter service is operational"
}
```

## Usage Example

### Frontend Integration

```typescript
async function extractTicketData(tcText: string) {
  try {
    const response = await fetch('/api/extract-tc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tcText })
    });

    const result = await response.json();

    if (result.success) {
      console.log('Extracted data:', result.data);
      console.log('Model used:', result.modelUsed);
      console.log('Latency:', result.telemetry.latencyMs + 'ms');
      return result.data;
    } else {
      console.error('Extraction failed:', result.error);
      return null;
    }
  } catch (error) {
    console.error('API call failed:', error);
    return null;
  }
}
```

### Direct Service Usage

```typescript
import { extractTCData, TCExtractionSchema } from '@/lib/openrouter-service';

const result = await extractTCData(tcText);

if (result.success) {
  const data: TCExtractionSchema = result.data;
  // Use extracted data
}
```

## Future Enhancements

### Telemetry Collection (TODO)

The service includes a `TelemetryCollector` class prepared for:

1. **Performance Tracking**: Record latency, success rates, and error patterns
2. **Supabase Persistence**: Store metrics in `model_telemetry` table
3. **Dynamic Reordering**: Automatically adjust model priority based on real-world performance
4. **Cost Optimization**: Track token usage and optimize for cost/performance balance

### Planned Supabase Schema

```sql
CREATE TABLE model_telemetry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id text NOT NULL,
  latency_ms integer NOT NULL,
  success boolean NOT NULL,
  timestamp timestamptz DEFAULT now(),
  token_count integer,
  error_message text
);

CREATE INDEX idx_model_telemetry_model ON model_telemetry(model_id);
CREATE INDEX idx_model_telemetry_timestamp ON model_telemetry(timestamp);
```

### Dynamic Reordering Algorithm

Future implementation will use:
- Success Rate Weight: 70%
- Latency Weight: 30%
- Score = (successRate × 0.7) - (avgLatencyMs/1000 × 0.3)

Models will be automatically reordered based on rolling 7-day performance windows.

## Environment Variables

Required in `.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-xxxxx
NEXT_PUBLIC_SITE_URL=http://localhost:3000  # Optional, for OpenRouter referer
```

## Error Handling

The service handles:
- Network timeouts (30s per model)
- API rate limits (automatic fallback)
- Invalid JSON responses (fallback to next model)
- Empty responses (fallback to next model)
- Model-specific errors (fallback to next model)

All errors are logged with model information for debugging.

## Testing

Test the health endpoint:
```bash
curl http://localhost:3000/api/extract-tc
```

Test extraction:
```bash
curl -X POST http://localhost:3000/api/extract-tc \
  -H "Content-Type: application/json" \
  -d '{"tcText": "Your T&C text here..."}'
```

## Architecture Compatibility

- ✅ Next.js 14 App Router
- ✅ TypeScript with strict types
- ✅ MUI frontend (API returns structured JSON)
- ✅ Tailwind CSS (no styling conflicts)
- ✅ Supabase ready (telemetry persistence prepared)
