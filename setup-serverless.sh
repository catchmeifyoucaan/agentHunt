#!/bin/bash

# Setup script for serverless inference integration
# This script helps configure the MODEL_ACCESS_KEY and test the integration

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Serverless Inference Setup for Three-Agent System"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if MODEL_ACCESS_KEY is already set
if [ -n "$MODEL_ACCESS_KEY" ]; then
    echo "✓ MODEL_ACCESS_KEY is already set in environment"
    echo "  Value: ${MODEL_ACCESS_KEY:0:10}***"
else
    echo "⚠ MODEL_ACCESS_KEY is not set"
    echo ""
    echo "Please enter your serverless inference API key:"
    read -r API_KEY

    if [ -z "$API_KEY" ]; then
        echo "❌ No API key provided. Exiting."
        exit 1
    fi

    export MODEL_ACCESS_KEY="$API_KEY"
    echo "✓ MODEL_ACCESS_KEY set for this session"

    # Ask to add to .env file
    echo ""
    echo "Add to .env file for persistence? (y/n)"
    read -r ADD_TO_ENV

    if [ "$ADD_TO_ENV" = "y" ]; then
        if [ -f ".env" ]; then
            # Check if MODEL_ACCESS_KEY already exists in .env
            if grep -q "MODEL_ACCESS_KEY" .env; then
                echo "⚠ MODEL_ACCESS_KEY already exists in .env file"
                echo "Please update it manually if needed"
            else
                echo "MODEL_ACCESS_KEY=$API_KEY" >> .env
                echo "✓ Added MODEL_ACCESS_KEY to .env file"
            fi
        else
            echo "MODEL_ACCESS_KEY=$API_KEY" > .env
            echo "✓ Created .env file with MODEL_ACCESS_KEY"
        fi
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Running Test Suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Run test suite
npx tsx backend/test-serverless-inference.ts

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Start the backend: npm run dev"
echo "  2. The three-agent system will now use serverless inference"
echo "  3. Monitor logs for 'serverless' to verify usage"
echo "  4. Check SERVERLESS_INFERENCE_INTEGRATION.md for details"
echo ""
