/**
 * OpenTelemetry metrics for the LRS service.
 *
 * Uses @opentelemetry/sdk-metrics with PrometheusExporter to expose
 * metrics in Prometheus text format.
 */

import type { Counter, Histogram, UpDownCounter, Attributes } from '@opentelemetry/api';
import { MeterProvider, View, ExplicitBucketHistogramAggregation } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter, PrometheusSerializer } from '@opentelemetry/exporter-prometheus';

export interface LrsMetrics {
  /** HTTP request duration by method/route/status */
  httpDuration: Histogram;
  /** xAPI statements received */
  statementsReceived: Counter;
  /** xAPI statements stored */
  statementsStored: Counter;
  /** xAPI statement validation errors */
  statementValidationErrors: Counter;
  /** Document resource operations */
  documentOps: Counter;
  /** DB query duration */
  dbQueryDuration: Histogram;
  /** SSE stream clients connected */
  sseClients: UpDownCounter;
  /** SSE events emitted */
  sseEventsEmitted: Counter;
  /** Auth failures */
  authFailures: Counter;
  /** Retrieve all metrics as Prometheus text */
  getPrometheusText(): Promise<string>;
  /** Shut down the meter provider */
  shutdown(): Promise<void>;
}

const METER_NAME = 'lrs';

export function createMetrics(): LrsMetrics {
  const exporter = new PrometheusExporter({ preventServerStart: true });
  const serializer = new PrometheusSerializer();

  const meterProvider = new MeterProvider({
    readers: [exporter],
    views: [
      new View({
        aggregation: new ExplicitBucketHistogramAggregation([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5]),
        instrumentName: 'lrs_http_request_duration_seconds',
      }),
      new View({
        aggregation: new ExplicitBucketHistogramAggregation([0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1]),
        instrumentName: 'lrs_db_query_duration_seconds',
      }),
    ],
  });

  const meter = meterProvider.getMeter(METER_NAME);

  // Counter names omit _total — PrometheusExporter appends it automatically.
  const httpDuration = meter.createHistogram('lrs_http_request_duration_seconds', {
    description: 'HTTP request duration in seconds',
    unit: 's',
  });

  const statementsReceived = meter.createCounter('lrs_xapi_statements_received', {
    description: 'Total xAPI statements received (before validation)',
  });

  const statementsStored = meter.createCounter('lrs_xapi_statements_stored', {
    description: 'Total xAPI statements stored successfully',
  });

  const statementValidationErrors = meter.createCounter('lrs_xapi_statement_validation_errors', {
    description: 'Total statement validation failures',
  });

  const documentOps = meter.createCounter('lrs_xapi_document_operations', {
    description: 'Total document resource operations',
  });

  const dbQueryDuration = meter.createHistogram('lrs_db_query_duration_seconds', {
    description: 'Database query duration in seconds',
    unit: 's',
  });

  const sseClients = meter.createUpDownCounter('lrs_sse_clients_connected', {
    description: 'Number of SSE stream clients currently connected',
  });

  const sseEventsEmitted = meter.createCounter('lrs_sse_events_emitted', {
    description: 'Total SSE events emitted to stream clients',
  });

  const authFailures = meter.createCounter('lrs_auth_failures', {
    description: 'Total authentication failures',
  });

  async function getPrometheusText(): Promise<string> {
    const { resourceMetrics } = await exporter.collect();
    return serializer.serialize(resourceMetrics);
  }

  async function shutdown(): Promise<void> {
    await meterProvider.shutdown();
  }

  return {
    httpDuration,
    statementsReceived,
    statementsStored,
    statementValidationErrors,
    documentOps,
    dbQueryDuration,
    sseClients,
    sseEventsEmitted,
    authFailures,
    getPrometheusText,
    shutdown,
  };
}

/**
 * Start a timer for a histogram, returning an `end()` function
 * that records the elapsed duration in seconds.
 */
export function startTimer(histogram: Histogram, attributes?: Attributes): () => void {
  const start = performance.now();
  return () => {
    histogram.record((performance.now() - start) / 1000, attributes);
  };
}
