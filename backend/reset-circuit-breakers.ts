import database from './src/services/database';

// Function to reset circuit breakers by updating the status of stuck handoffs
async function resetCircuitBreakers() {
  try {
    console.log(
      'Resetting circuit breakers by updating all circuit_breaker_open handoffs back to pending...'
    );

    // First, let's see what's in the rich_handoffs table
    const currentStats = await database.query(`
      SELECT status, COUNT(*) as count 
      FROM rich_handoffs 
      GROUP BY status 
      ORDER BY status
    `);

    console.log('Current rich_handoffs status distribution:');
    console.log(currentStats.rows);

    // Reset handoffs with circuit_breaker_open status back to pending
    const resetResult = await database.query(`
      UPDATE rich_handoffs 
      SET status = 'pending', 
          rejection_reason = NULL,
          completed_at = NULL
      WHERE status = 'circuit_breaker_open'
    `);

    console.log(`Reset ${resetResult.rowCount} handoffs from circuit_breaker_open to pending`);

    // Let's also reset any failed handoffs that might need reprocessing
    const resetFailedResult = await database.query(`
      UPDATE rich_handoffs 
      SET status = 'pending', 
          rejection_reason = NULL,
          completed_at = NULL
      WHERE status = 'failed'
      AND rejection_reason LIKE '%Circuit breaker%'
    `);

    console.log(`Reset ${resetFailedResult.rowCount} failed handoffs related to circuit breakers`);

    // Show new stats
    const newStats = await database.query(`
      SELECT status, COUNT(*) as count 
      FROM rich_handoffs 
      GROUP BY status 
      ORDER BY status
    `);

    console.log('New rich_handoffs status distribution:');
    console.log(newStats.rows);

    console.log(
      'Circuit breakers have been reset. The handoff processor should now be able to process these handoffs again.'
    );
  } catch (error) {
    console.error('Error resetting circuit breakers:', error);
  } finally {
    process.exit(0);
  }
}

resetCircuitBreakers();
