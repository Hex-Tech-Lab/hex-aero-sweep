#!/bin/bash

# AeroSweep Vercel Deployment Script
# Usage: ./deploy.sh

set -e

echo "🚀 Starting AeroSweep deployment..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    pnpm add -g vercel
fi

# Link project if not already linked
if [ ! -f ".vercel/project.json" ]; then
    echo "📎 Linking to Vercel project..."
    vercel link
fi

# Pull latest environment variables
echo "📥 Pulling environment variables..."
vercel env pull .env.local

# Build and deploy
echo "🔨 Building application..."
pnpm build

echo "🚀 Deploying to production..."
vercel deploy --prebuilt --prod

echo "✅ Deployment complete!"
echo ""
echo "To add new environment variables:"
echo "  vercel env add NEXT_PUBLIC_SUPABASE_URL production"
echo "  vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production"
