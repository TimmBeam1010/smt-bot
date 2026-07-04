#!/usr/bin/env node

/**
 * Trade Executor Bot (ФИНАЛЬНАЯ ВЕРСИЯ БЕЗ SUPABASE)
 * Получает сигналы через REST API, обновляет статус через API
 */

const { getExchange } = require('../../shared/exchanges');
const { calculatePositionSize, calculatePositionLevels } = require('../../shared/position-calculator');

// ===== ПРОСТОЙ ЛОГГЕР =====
const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
  userId: 11,
  maxPositions: 1,
  riskPercent: 0.3,
  leverage: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 5,
};

let exchangeClient = null;
let isProcessing = false;

// ===== ПОЛУЧЕНИЕ СИГНАЛОВ =====
async function getPendingSignals() {
  try {
    log.info(`📡 Запрос сигналов...`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch('https://smtbot.com/api/signals/user/trnabiev@gmail.com', {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`API статус ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Не массив');
    }
    
    const pending = data.filter(s => s.status === 'pending');
    log.info(`✅ Найдено ${pending.length} ожидающих сигналов`);
    
    pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return pending.slice(0, CONFIG.maxSignalsPerRun);
    
  } catch (error) {
    log.error(`❌ Ошибка получения сигналов: ${error.message}`);
    return [];
  }
}

// ===== ОБНОВЛЕНИЕ СТАТУСА СИГНАЛА =====
async function updateSignalStatus(signalId, status, data = {}) {
  try {
    const response = await fetch(`https://smtbot.com/api/signals/${signalId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: status,
        executed_at: new Date().toISOString(),
        ...data
      })
    });
    
    if (!response.ok) {
      throw new Error(`Статус ${response.status}`);
    }
    
    log.info(`✅ Сигнал ${signalId} обновлен: ${status}`);
    return true;
    
  } catch (error) {
    log.error(`❌ Ошибка обновления сигнала: ${error.message}`);
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
    
    // Обновляем статус через REST API
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
  log.info('🚀 Trade Executor Bot запущен (ФИНАЛЬНАЯ ВЕРСИЯ)');
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
