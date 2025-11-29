import queue from './src/services/queue';
import { trace } from '@opentelemetry/api';

// Create a simple test job to see if tracing is working
async function createTestJob() {
  console.log('Creating a test job to verify tracing...');

  try {
    // Start a trace span to test if tracing is working
    const tracer = trace.getTracer('test-tracing');
    const span = tracer.startSpan('test-job-creation');

    try {
      // Add a test job to the discovery queue with minimal data
      const testJob = await queue.addJob('discovery', {
        id: `test-job-${Date.now()}`,
        type: 'discovery',
        programId: 'test-program',
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        priority: 5,
      } as any);

      console.log('✓ Test job created successfully:', testJob.id);

      span.setAttributes({
        'test.job.id': testJob.id,
        'test.program.id': 'test-program',
        'test.queue': 'discovery',
      });

      console.log('✓ Tracing is working - spans are being created');
    } catch (error) {
      console.error('❌ Error creating test job:', error);
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }

    // Wait a bit to let the job process
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    console.error('❌ Error in test:', error);
    process.exit(1);
  }

  console.log('✓ Test completed - check Phoenix for traces at http://localhost:6006');
  process.exit(0);
}

createTestJob();
