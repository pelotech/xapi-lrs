/**
 * OpenTelemetry tracing for the LRS service.
 *
 * Off unless an OTLP endpoint is configured (OTEL_EXPORTER_OTLP_ENDPOINT or
 * OTEL_EXPORTER_OTLP_TRACES_ENDPOINT). When enabled, exports spans over OTLP/HTTP
 * and registers the AsyncLocalStorageContextManager + W3C tracecontext propagator.
 * Metrics are unaffected (see src/metrics.ts).
 */

import { createRequire } from 'node:module';
import { ProxyTracerProvider, type Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { NodeTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export interface TracingHandle {
  enabled: boolean;
  tracer: Tracer;
  shutdown(): Promise<void>;
}

// A private proxy provider with no delegate always returns a no-op tracer,
// independent of whatever gets registered on the GLOBAL provider later. Sourcing
// the disabled tracer from the global proxy would let a subsequent enabled
// initTracing() (which calls provider.register()) silently start recording spans
// on handles that reported enabled:false.
const NOOP_TRACER = new ProxyTracerProvider().getTracer('xapi-lrs');

export function initTracing(env: NodeJS.ProcessEnv = process.env): TracingHandle {
  const endpointConfigured =
    (env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT !== undefined && env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT !== '') ||
    (env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined && env.OTEL_EXPORTER_OTLP_ENDPOINT !== '');

  if (!endpointConfigured) {
    return { enabled: false, tracer: NOOP_TRACER, shutdown: async () => {} };
  }

  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME ?? 'xapi-lrs',
      [ATTR_SERVICE_VERSION]: version,
    }),
  );

  // OTLPTraceExporter reads OTEL_EXPORTER_OTLP_* natively; NodeTracerProvider
  // reads OTEL_TRACES_SAMPLER / _ARG from env (default parentbased_always_on).
  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });
  provider.register(); // installs AsyncLocalStorageContextManager + W3C propagator

  return {
    enabled: true,
    tracer: provider.getTracer('xapi-lrs'),
    shutdown: () => provider.shutdown(),
  };
}
