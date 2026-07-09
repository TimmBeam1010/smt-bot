module.exports = {
  apps: [
    {
      name: 'api',
      script: './api/server.js',
      cwd: '/root/smt-bot',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'signal-generator',
      script: './bots/signal-generator/index.js',
      cwd: '/root/smt-bot',
      instances: 1,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'trade-executor',
      script: './bots/trade-executor/index.js',
      cwd: '/root/smt-bot',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        BINGX_API_KEY: 'BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A',
        BINGX_SECRET_KEY: 'jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA',
        SUPABASE_URL: 'https://sbpyuigmrqycqlrjlqqv.supabase.co',
        SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHl1aWdtcnF5Y3FscmpscXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI4Nzc4MCwiZXhwIjoyMDk3ODYzNzgwfQ.g3C8YdCKmo53tSYLFMAv1YXh2OFsm7DZvKeIMGpnkT0',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};