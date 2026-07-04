#!/usr/bin/env node

/**
 * Signal Generator Bot (РЕШЕНИЕ ПРОБЛЕМЫ FETCH FAILED)
 * Использует прямой REST API к Supabase с правильными заголовками
 */

const { getExchange } = require('../../shared/exchanges');

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

const CONFIG = {
  symbols: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT'],
  checkInterval: 30000,
};

let exchangeClient = null;
let counter = 0;

// ===== СОХРАНЕНИЕ В SUPABASE =====
async function saveSignalDirectly(symbol, side, price) {
  try {
    const url = 'https://zqyalsprnbbjifjctdga.supabase.co/rest/v1/signals';
    const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxeWFsc3BybmJiamlmamN0ZGdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3OTk1MTgsImV4cCI6MjA1NzM3NTUxOH0.0Nt8hM5eZk7yjmjG2OV-5iDQBW0Z0aJQqg5CdIHEZUI';
    
    const signalData = {
      user_id: 11,
      symbol: symbol,
      side: side,
      entry_price: Math.round(price * 100) / 100,
      confidence: 'high',
      status: 'pending',
      reasons: [`Сигнал #${++counter}`],
      created_at: new Date().toISOString()
    };

    log.info(`💾 Сохранение: ${symbol} ${side} @ ${signalData.entry_price}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(signalData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    log.info(`✅ Сигнал сохранен! ID: ${result?.[0]?.id || 'OK'}`);
    return result;

  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
    return null;
  }
}

// ===== ГЕНЕРАЦИЯ =====
async function generateSignals() {
  try {
    log.info(`📊 Генерация...`);
    
    for (const symbol of CONFIG.symbols) {
      const price = 40000 + Math.random() * 50000;
      const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';
      await saveSignalDirectly(symbol, side, price);
    }
    
    log.info(`✅ Сгенерировано ${CONFIG.symbols.length} сигналов`);
    
  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  }
}

// ===== ОСНОВНОЙ ЦИКЛ =====
async function mainLoop() {
  try {
    if (!exchangeClient) {
      log.info('🔧 Инициализация клиента...');
      exchangeClient = getExchange('bingx', 
        process.env.BINGX_API_KEY || 'BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A',
        process.env.BINGX_SECRET_KEY || 'jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA'
      );
      log.info('✅ Клиент инициализирован');
    }

    await generateSignals();

  } catch (error) {
    log.error(`❌ Ошибка цикла: ${error.message}`);
  }
}

// ===== ЗАПУСК =====
async function start() {
  log.info('🚀 Signal Generator Bot запущен');
  log.info(`⏱️  Интервал: ${CONFIG.checkInterval / 1000}с`);
  
  await mainLoop();
  setInterval(mainLoop, CONFIG.checkInterval);
}

if (require.main === module) {
  start().catch(error => {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, saveSignalDirectly };
