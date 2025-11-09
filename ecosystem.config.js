module.exports = {
  apps: [
    {
      name: 'agenthunt-backend',
      cwd: './backend',
      script: 'dist/backend/src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      env: {
        NODE_ENV: 'production',
        UV_THREADPOOL_SIZE: 128,
      },
      error_file: '../logs/backend-error.log',
      out_file: '../logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'agenthunt-workers',
      cwd: './backend',
      script: 'dist/backend/src/workers.js',
      instances: 3, // 3 instances for 4 CPU cores (leave 1 for backend)
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '4G', // Increased memory limit
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production',
        UV_THREADPOOL_SIZE: 128, // Max Node.js thread pool
      },
      error_file: '../logs/workers-error.log',
      out_file: '../logs/workers-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
    {
      name: 'agenthunt-frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
      error_file: '../logs/frontend-error.log',
      out_file: '../logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
