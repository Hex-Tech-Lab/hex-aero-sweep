import { NextRequest, NextResponse } from 'next/server';
import { extractTCData, healthCheck } from '@/lib/openrouter-service';

/**
 * POST /api/extract-tc
 * Extract structured data from T&C text using OpenRouter LLM with fallbacks
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tcText } = body;

    if (!tcText || typeof tcText !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid tcText parameter' },
        { status: 400 }
      );
    }

    if (tcText.trim().length === 0) {
      return NextResponse.json(
        { error: 'tcText cannot be empty' },
        { status: 400 }
      );
    }

    // Perform extraction with sequential fallback
    const result = await extractTCData(tcText);

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || 'Extraction failed',
          modelUsed: result.modelUsed,
          telemetry: result.telemetry
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      modelUsed: result.modelUsed,
      telemetry: result.telemetry
    });

  } catch (error: any) {
    console.error('Extract T&C API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/extract-tc
 * Health check endpoint
 */
export async function GET() {
  try {
    const health = await healthCheck();

    return NextResponse.json(
      health,
      { status: health.healthy ? 200 : 503 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { healthy: false, message: error.message },
      { status: 503 }
    );
  }
}
