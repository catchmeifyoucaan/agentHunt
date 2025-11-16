import IORedis from 'ioredis';
import config from './src/config';

// Create a direct Redis connection using the same configuration as the queue
const redis = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  tls: config.redis.tls ? { rejectUnauthorized: false } : undefined,
});

async function clearRedisJobs() {
  try {
    console.log('Connecting to Redis...');
    
    // Wait for connection to be ready
    await redis.ping();
    console.log('Connected to Redis successfully');
    
    console.log('Flushing all Redis data...');
    await redis.flushall();
    console.log('Redis data cleared successfully');
    
    console.log('Verifying Redis is empty...');
    const dbsize = await redis.dbsize();
    console.log(`Number of keys in Redis after flush: ${dbsize}`);
    
    await redis.quit();
    console.log('Redis connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error clearing Redis:', error);
    await redis.quit();
    process.exit(1);
  }
}

// Run the function
clearRedisJobs();