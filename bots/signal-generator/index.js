#!/usr/bin/env node

/**
 * Signal Generator Bot (СТАБИЛЬНАЯ ВЕРСИЯ)
 */

const { getExchange } = require('../../shared/exchanges');
const trading = require('../../shared/trading');

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

const CONFIG = {
  symbols: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT'],
  interval: '5m',
  limit: 100,
  checkInterval: 30000,
};

const supabaseUrl = 'https://sbpyuigmrqycqlrjlqqv.supabase.co';
const supabaseKey = 'sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd';

let exchangeClient = null;

async function supabaseRequest(method, endpoint, data = null) {
  const url = `${supabaseUrl}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  const options = { method, headers };
  if (data) options.body = JSON.stringify(data);
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

async function saveSignalDirectly(signal) {
  try {
    if (!signal) return null;
    
    if (signal.confidence === 'low') {
      log.warn(`⛔ БЛОКИРОВКА LOW: ${signal.symbol} ${signal.side}`);
      return null;
    }
    
    if (signal.confidence !== 'medium' && signal.confidence !== 'high') {
      log.warn(`⛔ БЛОКИРОВКА НЕИЗВЕСТНЫЙ: ${signal.symbol} ${signal.side} (${signal.confidence})`);
      return null;
    }

    const signalData = {
      user_id: 11,
      symbol: signal.symbol,
      side: signal.side,
      entry_price: Math.round(signal.entry * 100) / 100,
      confidence: signal.confidence,
      status: 'pending',
      reasons: signal.reasons || [],
      rsi: signal.rsi || null,
      macd: signal.macd || null,
      created_at: new Date().toISOString()
    };

    log.info(`💾 СОХРАНЕНИЕ: ${signal.symbol} ${signal.side} (${signal.confidence})`);

    const result = await supabaseRequest('POST', 'signals', signalData);
    log.info(`✅ СОХРАНЕН! ID: ${result?.[0]?.id || 'OK'}`);
    return result;

  } catch (error) {
    log.error(`❌ Ошибка сохранения: ${error.message}`);
    return null;
  }
}

async function analyzeAndGenerateSignal(symbol) {
  try {
    if (!exchangeClient) return;
    
    const candles = await exchangeClient.getCandles(symbol, CONFIG.interval, CONFIG.limit);
    if (!candles || candles.length < 30) {
      log.warn(`Недостаточно свечей для ${symbol}`);
      return;
    }
    
    const prices = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);
    
    const signal = trading.generateSignal(symbol, prices, { highs, lows, volumes });
    if (!signal) return;
    
    await saveSignalDirectly(signal);
    
  } catch (error) {
    log.error(`Ошибка анализа ${symbol}: ${error.message}`);
  }
}

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
    
    log.info(`📊 Анализ ${CONFIG.symbols.length} символов...`);
    for (const symbol of CONFIG.symbols) {
      await analyzeAndGenerateSignal(symbol);
    }
    
  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  }
}

async function start() {
  log.info('🚀 Signal Generator Bot запущен (СТАБИЛЬНАЯ ВЕРСИЯ)');
  log.info(`📋 Таймфрейм: ${CONFIG.interval}`);
  log.info(`📋 Символы: ${CONFIG.symbols.length}`);
  log.info(`⏱️ Интервал: ${CONFIG.checkInterval / 1000}с`);
  await mainLoop();
  setInterval(mainLoop, CONFIG.checkInterval);
}

if (require.main === module) {
  start().catch(error => {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, analyzeAndGenerateSignal };

async function start() {
    log.info('🚀 Signal Generator Bot запущен');
    log.info(`📋 Таймфрейм: ${CONFIG.interval}`);
    log.info(`📋 Символы: ${CONFIG.symbols.length}`);
    log.info(`⏱️ Интервал: ${CONFIG.checkInterval / 1000}с`);
    await mainLoop();
    setInterval(mainLoop, CONFIG.checkInterval);
}

if (require.main === module) {
    start().catch(error => {
        console.error(`❌ Критическая ошибка: ${error.message}`);
        process.exit(1);
    });
}
