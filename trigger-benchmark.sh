#!/bin/bash

# Script to trigger the benchmark workflow via GitHub CLI
# Usage: ./trigger-benchmark.sh [comparison|production-hybrid|experimental|original] [num_payments]

BENCHMARK_TYPE=${1:-comparison}
NUM_PAYMENTS=${2:-5}

echo "🚀 Triggering Spark Payment Benchmark..."
echo "📊 Benchmark Type: $BENCHMARK_TYPE"
echo "🔢 Number of Payments: $NUM_PAYMENTS"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first:"
    echo "   brew install gh"
    echo "   Or visit: https://cli.github.com/"
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub CLI. Please run:"
    echo "   gh auth login"
    exit 1
fi

# Trigger the workflow
echo "⚡ Triggering workflow..."
gh workflow run "benchmark-spark-payments.yml" \
  --field benchmark_type="$BENCHMARK_TYPE" \
  --field num_payments="$NUM_PAYMENTS"

if [ $? -eq 0 ]; then
    echo "✅ Workflow triggered successfully!"
    echo "🔗 View the run at: https://github.com/$(gh repo view --json owner,name -q '.owner.login + "/" + .name')/actions"
    echo ""
    echo "💡 You can also watch the run with:"
    echo "   gh run watch"
else
    echo "❌ Failed to trigger workflow"
    exit 1
fi