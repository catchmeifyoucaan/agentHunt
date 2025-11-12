#!/usr/bin/env node
/**
 * Workers Entry Point
 * Starts all worker processes
 */

// Initialize OpenTelemetry tracing FIRST (must be before other imports)
import './services/tracing';

// Import and run workers
import './workers/index';
