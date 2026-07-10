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
        BINGX_API_KEY: 'qccV1dMjaXbxHXrP5860852NXvvSzIFlxgqq9lMzrdJbQVIsDV9uqZVbzzoMbP7XC535MyZtA6V3q3Os5Rsw',
        BINGX_SECRET_KEY: 'pDI97GY1VKyxAyg3YN7p2bD4pRgirVMdWCwWvhpLclAAPuDyA6UhAMVLpCiuSA1ACnYgIocbAn5ZaKSkagyhvg',
        SUPABASE_URL: 'https://sbpyuigmrqycqlrjlqqv.supabase.co',
        SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHl1aWdtcnF5Y3FscmpscXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI4Nzc4MCwiZXhwIjoyMDk3ODYzNzgwfQ.g3C8YdCKmo53tSYLFMAv1YXh2OFsm7DZvKeIMGpnkT0',
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};