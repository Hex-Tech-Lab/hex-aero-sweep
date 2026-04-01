import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse';
import { extractTCData } from '@/lib/openrouter-service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    console.log('[API] 1. Received File');
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size exceeds 10MB limit' },
        { status: 400 }
      );
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'File must be a PDF' },
        { status: 400 }
      );
    }

    let fullText: string = '';

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const data = await pdf(buffer);
      fullText = data.text;

      if (!fullText || fullText.trim().length === 0) {
        throw new Error('PDF extraction returned empty text');
      }

      if (fullText.trim().length < 50) {
        throw new Error('PDF Extraction Failed: Unreadable format');
      }

      console.log('[API] 2. PDF Text Extracted, length:', fullText.length);
      console.log('[PDF Parse] Successfully extracted PDF text');
      console.log(`[PDF Parse] Text length: ${fullText.length} characters`);

    } catch (pdfError) {
      console.error('[PDF Parse] Failed to extract PDF text:', pdfError);
      return NextResponse.json(
        { error: 'Failed to extract text from PDF. Please ensure the PDF is not encrypted or corrupted.' },
        { status: 400 }
      );
    }

    console.log('[API] 3. Calling OpenRouter');

    try {
      const llmResult = await extractTCData(fullText);
      console.log('[API] 4. OpenRouter Responded');

      if (!llmResult.success || !llmResult.data) {
        const errorMsg = llmResult.error || 'Unknown LLM error';
        console.error('[OpenRouter] LLM extraction failed:', errorMsg);
        console.error('[OpenRouter] Full error payload:', JSON.stringify(llmResult, null, 2));

        if (llmResult.rawResponse) {
          console.error('[OpenRouter] Raw LLM Response:', llmResult.rawResponse);
        }

        return NextResponse.json(
          {
            error: `OpenRouter LLM extraction failed: ${errorMsg}. Please verify OPENROUTER_API_KEY is configured.`,
            rawResponse: llmResult.rawResponse,
            latency: llmResult.telemetry?.latencyMs,
            modelUsed: llmResult.modelUsed,
            details: llmResult
          },
          { status: 422 }
        );
      }

      console.log(`[OpenRouter] ✓ Successfully extracted T&C data using model: ${llmResult.modelUsed}`);
      console.log(`[OpenRouter] ✓ Latency: ${llmResult.telemetry?.latencyMs}ms`);
      console.log(`[OpenRouter] ✓ Extracted PNR: ${llmResult.data.pnr}`);
      console.log(`[OpenRouter] ✓ Extracted Passengers: ${JSON.stringify(llmResult.data.passengers)}`);

      if (!llmResult.data.pnr || !llmResult.data.passengers || llmResult.data.passengers.length === 0) {
        console.error('[OpenRouter] LLM returned incomplete data:', llmResult.data);
        return NextResponse.json(
          {
            error: 'LLM extraction incomplete: Missing critical ticket information (PNR or passenger names)',
            data: llmResult.data
          },
          { status: 422 }
        );
      }

      const issueDate = llmResult.data.issueDate ? new Date(llmResult.data.issueDate) : new Date();
      const expirationDate = new Date(issueDate);
      expirationDate.setFullYear(expirationDate.getFullYear() + 1);

      const passengerCount = llmResult.data.passengerCount || llmResult.data.passengers?.length || 1;
      const lastPassengerName = llmResult.data.passengers?.[llmResult.data.passengers.length - 1] || 'PASSENGER';

      return NextResponse.json({
        success: true,
        data: {
          pnr: llmResult.data.pnr.toUpperCase(),
          primaryPassengerLastName: llmResult.data.primaryPassengerLastName?.toUpperCase() || lastPassengerName.split(' ').pop()?.toUpperCase() || 'PASSENGER',
          passengers: {
            adults: passengerCount,
            children: 0
          },
          fareClass: llmResult.data.fareClass || 'ECONOMY',
          baseCost: llmResult.data.baseFare || 0,
          issueDate: issueDate.toISOString().split('T')[0],
          expirationDate: expirationDate.toISOString().split('T')[0],
          rules: {
            validity: llmResult.data.validity || 'Ticket valid for 1 year from issue',
            luggage: llmResult.data.baggageAllowance || 'Standard allowance per fare class',
            cancellation: llmResult.data.cancellationPolicy || 'Subject to fare rules and conditions',
          },
        },
        metadata: {
          modelUsed: llmResult.modelUsed,
          latencyMs: llmResult.telemetry?.latencyMs,
        },
      });

    } catch (llmError: any) {
      console.error('[OpenRouter] LLM invocation error:', llmError);
      console.error('[OpenRouter] Error stack:', llmError.stack);

      return NextResponse.json(
        {
          error: `OpenRouter API connection failed: ${llmError.message}. Check OPENROUTER_API_KEY and network connectivity.`,
          stack: llmError.stack
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('[PDF Parse] Unexpected error:', error);

    return NextResponse.json(
      {
        error: `Unexpected server error: ${error.message}`,
        stack: error.stack
      },
      { status: 500 }
    );
  }
}
