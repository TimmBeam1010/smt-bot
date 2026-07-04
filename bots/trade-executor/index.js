#!/usr/bin/env node

/**
 * Trade Executor Bot (С ГЕНЕРАЦИЕЙ ТЕСТОВЫХ СИГНАЛОВ)
 * Если сигналов нет - создает тестовые напрямую в Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const { getExchange } = require('../../shared/exchanges');
const { calculatePositionSize, calculatePositionLevels } = require('../../shared/position-calculator');

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

// ===== КОНФИГ =====
const CONFIG = {
  userId: 11,
  maxPositions: 1,
  riskPercent: 0.3,
  leverage: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 5,
  testSymbols: ['BTC-USDT', 'ETH-USDT', 'SOL-USDT']
};

// ===== SUPABASE (БЕЗ WEBSOCKET) =====
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://zqyalsprnbbjifjctdga.supabase.co',
  process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxeWFsc3BybmJiamlmamN0ZGdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3OTk1MTgsImV4cCI6MjA1NzM3NTUxOH0.0Nt8hM5eZk7yjmjG2OV-5iDQBW0Z0aJQqg5CdIHEZUI',
  { realtime: { enabled: false } }
);

let exchangeClient = null;
let isProcessing = false;

// ===== ГЕНЕРАЦИЯ ТЕСТОВЫХ СИГНАЛОВ =====
async function generateTestSignals() {
  try {
    log.info('📊 Генерация тестовых сигналов...');
    let count = 0;

    for (const symbol of CONFIG.testSymbols) {
      const price = 50000 + Math.random() * 30000;
      const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';
      
      const signalData = {
        user_id: CONFIG.userId,
        symbol: symbol,
        side: side,
        entry_price: Math.round(price * 100) / 100,
        confidence: 'high',
        status: 'pending',
        reasons: ['Тестовый сигнал для автоторговли'],
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('signals')
        .insert([signalData])
        .select();

      if (error) {
        log.error(`❌ Ошибка создания ${symbol}: ${error.message}`);
      } else {
        log.info(`✅ Создан сигнал: ${symbol} ${side} @ ${signalData.entry_price}`);
        count++;
      }
    }

    log.info(`✅ Создано ${count} тестовых сигналов`);
    return count;

  } catch (error) {
    log.error(`❌ Ошибка генерации: ${error.message}`);
    return 0;
  }
}

// ===== ПОЛУЧЕНИЕ СИГНАЛОВ =====
async function getPendingSignals() {
  try {
    log.info(`📡 Запрос сигналов...`);
    
    const response = await fetch('https://smtbot.com/api/signals/user/11', {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) throw new Error(`API статус ${response.status}`);

    const data = await response.json();
    let signalsArray = data?.signals || [];

    if (!Array.isArray(signalsArray)) {
      log.warn('⚠️ Не массив, пробуем другой формат');
      signalsArray = Array.isArray(data) ? data : [];
    }

    const pending = signalsArray.filter(s => s && s.status === 'pending');
    log.info(`✅ Найдено ${pending.length} ожидающих сигналов (всего: ${signalsArray.length})`);

    if (pending.length === 0) {
      log.info('📭 Сигналов нет, генерируем тестовые...');
      await generateTestSignals();
      // Повторный запрос после генерации
      const response2 = await fetch('https://smtbot.com/api/signals/user/11', {
        headers: { 'Accept': 'application/json' }
      });
      const data2 = await response2.json();
      const pending2 = (data2?.signals || []).filter(s => s && s.status === 'pending');
      log.info(`✅ После генерации: ${pending2.length} сигналов`);
      return pending2.slice(0, CONFIG.maxSignalsPerRun);
    }

    pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return pending.slice(0, CONFIG.maxSignalsPerRun);

  } catch (error) {
    log.error(`❌ Ошибка получения сигналов: ${error.message}`);
    return [];
  }
}

// ===== ОБНОВЛЕНИЕ СТАТУСА =====
async function updateSignalStatus(signalId, status, data = {}) {
  try {
    const response = await fetch(`https://smtbot.com/api/signals/${signalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, executed_at: new Date().toISOString(), ...data })
    });
    if (!response.ok) throw new Error(`Статус ${response.status}`);
    log.info(`✅ Сигнал ${signalId} обновлен: ${status}`);
    return true;
  } catch (error) {
    log.error(`❌ Ошибка обновления: ${error.message}`);
    return false;
  }
}

// ===== ПОЛУЧЕНИЕ СВЕЧЕЙ =====
async function getCandles(symbol) {
  try {
    if (!exchangeClient || typeof exchangeClient.getCandles !== 'function') return [];
    const candles = await exchangeClient.getCandles({ symbol, interval: '5m', limit: 50 });
    log.info(`✅ Получено ${candles?.length || 0} свечей для ${symbol}`);
    return candles || [];
  } catch (error) {
    log.error(`❌ Ошибка свечей: ${error.message}`);
    return [];
  }
}

// ===== ПРОВЕРКА ПОЗИЦИЙ =====
async function getActivePositions() {
  try {
    if (!exchangeClient) return { long: 0, short: 0 };
    const positions = await exchangeClient.getPositions();
    let longCount = 0, shortCount = 0;
    if (positions && Array.isArray(positions)) {
      positions.forEach(pos => {
        const size = parseFloat(pos.size || pos.quantity || 0);
        if (size > 0.0001) {
          if (pos.side === 'LONG' || pos.positionSide === 'LONG') longCount++;
          else if (pos.side === 'SHORT' || pos.positionSide === 'SHORT') shortCount++;
        }
      });
    }
    return { long: longCount, short: shortCount };
  } catch (error) {
    log.error(`❌ Ошибка позиций: ${error.message}`);
    return { long: 0, short: 0 };
  }
}

// ===== ВЫПОЛНЕНИЕ СДЕЛКИ =====
async function executeTrade(signal) {
  try {
    log.info(`🚀 Открытие: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);
    if (!exchangeClient) throw new Error('Клиент не инициализирован');
    
    const balance = await exchangeClient.getBalance();
    log.info(`💰 Баланс: ${balance} USDT`);
    if (!balance || balance < 5) throw new Error(`Недостаточно средств: ${balance || 0} USDT`);

    const entry = parseFloat(signal.entry_price);
    const sl = signal.side === 'LONG' ? entry * 0.985 : entry * 1.015;
    const tp = signal.side === 'LONG' ? entry * 1.03 : entry * 0.97;

    const positionSize = calculatePositionSize({
      balance, riskPercent: CONFIG.riskPercent, entryPrice: entry,
      stopLoss: sl, leverage: CONFIG.leverage
    });

    if (!positionSize || positionSize <= 0) throw new Error(`Некорректный размер: ${positionSize}`);

    const sideMap = { 'LONG': 'BUY', 'SHORT': 'SELL' };
    const order = await exchangeClient.placeOrder({
      symbol: String(signal.symbol).toUpperCase().trim(),
      side: sideMap[signal.side.toUpperCase()],
      type: 'MARKET',
      quantity: positionSize,
      leverage: CONFIG.leverage,
      positionSide: signal.side.toUpperCase()
    });

    log.info(`✅ Сделка открыта: ${order.orderId || 'OK'}`);
    await updateSignalStatus(signal.id, 'executed', {
      order_id: order.orderId || null,
      stop_loss: sl,
      take_profit: tp
    });
    return order;

  } catch (error) {
    log.error(`❌ Ошибка сделки: ${error.message}`);
    await updateSignalStatus(signal.id, 'failed', { error: error.message });
    throw error;
  }
}

// ===== ОСНОВНОЙ ЦИКЛ =====
async function mainLoop() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    if (!exchangeClient) {
      log.info('🔧 Инициализация клиента...');
      exchangeClient = getExchange('bingx', 
        process.env.BINGX_API_KEY || 'BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A',
        process.env.BINGX_SECRET_KEY || 'jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA'
      );
      log.info('✅ Клиент инициализирован');
    }

    const signals = await getPendingSignals();
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов для исполнения');
      return;
    }

    log.info(`📨 Найдено ${signals.length} сигналов для обработки`);
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
  log.info('🚀 Trade Executor Bot запущен (с генерацией сигналов)');
  log.info(`📋 Интервал: ${CONFIG.checkInterval / 1000}с`);
  await mainLoop();
  setInterval(mainLoop, CONFIG.checkInterval);
}

if (require.main === module) {
  start().catch(error => {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, getPendingSignals, executeTrade };
