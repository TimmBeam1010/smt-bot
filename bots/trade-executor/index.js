#!/usr/bin/env node

/**
 * Trade Executor Bot (С ПРЯМЫМ ДОСТУПОМ К SUPABASE)
 * Получает сигналы напрямую из Supabase
 */

const { getExchange } = require('../../shared/exchanges');
const { calculatePositionSize, calculatePositionLevels } = require('../../shared/position-calculator');
const { createClient } = require('@supabase/supabase-js');

// ===== ПРОСТОЙ ЛОГГЕР =====
const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
  maxPositions: 1,
  riskPercent: 0.3,
  leverage: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 5,
};

// ===== SUPABASE КЛИЕНТ =====
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://sbpyuigmrqycqlrjlqqv.supabase.co',
  process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHl1aWdtcnF5Y3FscmpscXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNDU2Nzg5MCwiZXhwIjoyMDYwMTQzODkwfQ.ВАШ_SERVICE_ROLE_КЛЮЧ' // ЗАМЕНИТЕ НА РЕАЛЬНЫЙ!
);

let exchangeClient = null;
let isProcessing = false;

// ===== ПОЛУЧЕНИЕ СИГНАЛОВ ИЗ SUPABASE =====
async function getPendingSignals() {
  try {
    log.info(`📡 Запрос сигналов из Supabase...`);
    
    const { data, error } = await supabase
      .from('signals')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(CONFIG.maxSignalsPerRun);

    if (error) {
      log.error(`❌ Ошибка Supabase: ${error.message}`);
      return [];
    }

    log.info(`✅ Получено ${data?.length || 0} сигналов из Supabase`);
    return data || [];
    
  } catch (error) {
    log.error(`❌ Исключение при запросе к Supabase: ${error.message}`);
    return [];
  }
}

// ===== ОБНОВЛЕНИЕ СТАТУСА В SUPABASE =====
async function updateSignalStatus(signalId, status, data = {}) {
  try {
    const { error } = await supabase
      .from('signals')
      .update({
        status: status,
        executed_at: new Date().toISOString(),
        ...data
      })
      .eq('id', signalId);

    if (error) {
      log.error(`❌ Ошибка обновления: ${error.message}`);
      return false;
    }

    log.info(`✅ Сигнал ${signalId} обновлен: ${status}`);
    return true;
    
  } catch (error) {
    log.error(`❌ Ошибка обновления статуса: ${error.message}`);
    return false;
  }
}

// ===== ПОЛУЧЕНИЕ СВЕЧЕЙ =====
async function getCandles(symbol) {
  try {
    if (!exchangeClient) {
      return [];
    }
    
    log.info(`📊 Запрос свечей для ${symbol}...`);
    
    if (typeof exchangeClient.getCandles !== 'function') {
      log.warn(`⚠️ Метод getCandles не найден`);
      return [];
    }
    
    const candles = await exchangeClient.getCandles({
      symbol: symbol,
      interval: '5m',
      limit: 100
    });
    
    log.info(`✅ Получено ${candles?.length || 0} свечей`);
    return candles || [];
    
  } catch (error) {
    log.error(`❌ Ошибка получения свечей: ${error.message}`);
    return [];
  }
}

// ===== ПРОВЕРКА ПОЗИЦИЙ =====
async function getActivePositions() {
  try {
    if (!exchangeClient) {
      return { long: 0, short: 0 };
    }
    
    const positions = await exchangeClient.getPositions();
    let longCount = 0;
    let shortCount = 0;
    
    if (positions && Array.isArray(positions)) {
      positions.forEach(pos => {
        const size = parseFloat(pos.size || pos.quantity || 0);
        if (size > 0) {
          if (pos.side === 'LONG' || pos.positionSide === 'LONG') longCount++;
          else if (pos.side === 'SHORT' || pos.positionSide === 'SHORT') shortCount++;
        }
      });
    }
    
    return { long: longCount, short: shortCount };
    
  } catch (error) {
    log.error(`❌ Ошибка получения позиций: ${error.message}`);
    return { long: 0, short: 0 };
  }
}

// ===== ВЫПОЛНЕНИЕ СДЕЛКИ =====
async function executeTrade(signal) {
  try {
    log.info(`🚀 Открытие: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);
    
    if (!exchangeClient) {
      throw new Error('Клиент не инициализирован');
    }
    
    const balance = await exchangeClient.getBalance();
    log.info(`💰 Баланс: ${balance} USDT`);
    
    if (!balance || balance < 10) {
      throw new Error(`Недостаточно средств: ${balance || 0} USDT`);
    }
    
    const candles = await getCandles(signal.symbol);
    
    if (candles.length === 0) {
      log.warn(`⚠️ Нет свечей, используем дефолтные значения`);
    }
    
    const indicators = {
      atr: signal.atr || 0.02,
      rsi: signal.rsi || 50,
      macd: signal.macd || 0
    };
    
    const levels = calculatePositionLevels(
      signal.symbol,
      signal.entry_price,
      candles,
      indicators,
      signal.side,
      { minRatio: 2.0 }
    );
    
    log.info(`🎯 SL: ${levels.stopLoss} (риск: ${levels.risk})`);
    log.info(`🎯 TP: ${levels.takeProfit} (прибыль: ${levels.reward})`);
    log.info(`📊 Risk/Reward: 1:${levels.ratio} ${levels.valid ? '✅' : '❌'}`);
    
    const positionSize = calculatePositionSize({
      balance: balance,
      riskPercent: CONFIG.riskPercent,
      entryPrice: signal.entry_price,
      stopLoss: levels.stopLoss,
      leverage: CONFIG.leverage
    });
    
    const order = await exchangeClient.placeOrder({
      symbol: signal.symbol,
      side: signal.side,
      type: 'MARKET',
      quantity: positionSize,
      leverage: CONFIG.leverage,
      stopLoss: levels.stopLoss,
      takeProfit: levels.takeProfit,
      positionSide: signal.side.toUpperCase()
    });
    
    log.info(`✅ Сделка открыта: ${order.orderId || 'OK'}`);
    
    // Обновляем статус в Supabase
    await updateSignalStatus(signal.id, 'executed', {
      order_id: order.orderId || null,
      stop_loss: levels.stopLoss,
      take_profit: levels.takeProfit
    });
    
    return order;
    
  } catch (error) {
    log.error(`❌ Ошибка сделки: ${error.message}`);
    
    // Обновляем статус на failed
    await updateSignalStatus(signal.id, 'failed', {
      error: error.message
    });
    
    throw error;
  }
}

// ===== ОСНОВНОЙ ЦИКЛ =====
async function mainLoop() {
  if (isProcessing) {
    log.debug('⏳ Предыдущий цикл выполняется');
    return;
  }
  
  isProcessing = true;
  
  try {
    if (!exchangeClient) {
      log.info('🔧 Инициализация Exchange клиента...');
      
      exchangeClient = getExchange('bingx', 
        process.env.BINGX_API_KEY || 'BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A',
        process.env.BINGX_SECRET_KEY || 'jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA'
      );
      
      log.info('✅ Клиент инициализирован');
    }
    
    const signals = await getPendingSignals();
    
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов');
      return;
    }
    
    log.info(`📨 Найдено ${signals.length} сигналов`);
    
    const positions = await getActivePositions();
    log.info(`📊 Позиции: LONG=${positions.long}, SHORT=${positions.short}`);
    
    for (const signal of signals) {
      const side = signal.side.toUpperCase();
      
      if (side === 'LONG' && positions.long >= CONFIG.maxPositions) {
        log.info(`⏸️ Пропускаем LONG (уже ${positions.long})`);
        continue;
      }
      
      if (side === 'SHORT' && positions.short >= CONFIG.maxPositions) {
        log.info(`⏸️ Пропускаем SHORT (уже ${positions.short})`);
        continue;
      }
      
      await executeTrade(signal);
    }
    
  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

// ===== ЗАПУСК =====
async function start() {
  log.info('🚀 Trade Executor Bot запущен (ПРЯМОЙ ДОСТУП К SUPABASE)');
  log.info(`📋 Интервал: ${CONFIG.checkInterval / 1000}с`);
  
  await mainLoop();
  setInterval(mainLoop, CONFIG.checkInterval);
  
  process.on('SIGINT', () => {
    log.info('🛑 Остановлен');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log.info('🛑 Остановлен');
    process.exit(0);
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, getPendingSignals, executeTrade };