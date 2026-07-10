#!/usr/bin/env node

require('dotenv').config({ path: '/root/smt-bot/.env' });

const { getExchange } = require('../../shared/exchanges');
const { calculatePositionSize, calculatePositionLevels } = require('../../shared/position-calculator');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

// ============================================
//  КОНФИГУРАЦИЯ ТОРГОВЛИ
// ============================================
const CONFIG = {
  maxPositions: 10,
  riskPercent: 0.05,
  leverage: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 20,
  minBalance: 10,
};

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://sbpyuigmrqycqlrjlqqv.supabase.co',
  process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHl1aWdtcnF5Y3FscmpscXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI4Nzc4MCwiZXhwIjoyMDk3ODYzNzgwfQ.g3C8YdCKmo53tSYLFMAv1YXh2OFsm7DZvKeIMGpnkT0',
  {
    realtime: {
      transport: WebSocket
    }
  }
);

let exchangeClient = null;
let isProcessing = false;

// ============================================
//  ПОЛУЧЕНИЕ СИГНАЛОВ ИЗ БАЗЫ
// ============================================
async function getPendingSignals() {
  try {
    log.info(`📡 Запрос сигналов из Supabase...`);
    const { data, error } = await supabase.from('signals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(CONFIG.maxSignalsPerRun);
    if (error) throw error;
    log.info(`✅ Получено ${data?.length || 0} сигналов`);
    return data || [];
  } catch (error) {
    log.error(`❌ Ошибка Supabase: ${error.message}`);
    return [];
  }
}

// ============================================
//  ОБНОВЛЕНИЕ СТАТУСА СИГНАЛА
// ============================================
async function updateSignalStatus(signalId, status, data = {}) {
  try {
    const { error } = await supabase.from('signals').update({ status, executed_at: new Date().toISOString(), ...data }).eq('id', signalId);
    if (error) throw error;
    log.info(`✅ Сигнал ${signalId} → ${status}`);
    return true;
  } catch (error) {
    log.error(`❌ Ошибка обновления: ${error.message}`);
    return false;
  }
}

// ============================================
//  ПОЛУЧЕНИЕ СВЕЧЕЙ
// ============================================
async function getCandles(symbol) {
  try {
    if (!exchangeClient) return [];
    return await exchangeClient.getCandles({ symbol, interval: '5m', limit: 100 }) || [];
  } catch (error) {
    log.error(`❌ Ошибка свечей: ${error.message}`);
    return [];
  }
}

// ============================================
//  ПОЛУЧЕНИЕ АКТИВНЫХ ПОЗИЦИЙ
// ============================================
async function getActivePositions() {
  try {
    if (!exchangeClient) return { long: 0, short: 0, total: 0, positions: [] };
    const positions = await exchangeClient.getPositions();
    let long = 0, short = 0, total = 0;
    const activePositions = [];

    if (positions && Array.isArray(positions)) {
      positions.forEach(pos => {
        const size = parseFloat(pos.size || pos.quantity || 0);
        if (size > 0) {
          total++;
          activePositions.push(pos);
          if (pos.side === 'LONG' || pos.positionSide === 'LONG') long++;
          else if (pos.side === 'SHORT' || pos.positionSide === 'SHORT') short++;
        }
      });
    }
    return { long, short, total, positions: activePositions };
  } catch (error) {
    log.error(`❌ Ошибка позиций: ${error.message}`);
    return { long: 0, short: 0, total: 0, positions: [] };
  }
}

// ============================================
//  ПРОВЕРКА, ЕСТЬ ЛИ УЖЕ СДЕЛКА ПО ЭТОЙ МОНЕТЕ
// ============================================
async function hasActivePositionForSymbol(symbol) {
  try {
    const positions = await exchangeClient.getPositions();
    if (!positions || !Array.isArray(positions)) return false;

    const cleanSymbol = symbol.replace(/-/g, '').toUpperCase();
    return positions.some(pos => {
      const size = parseFloat(pos.size || pos.quantity || 0);
      const posSymbol = (pos.symbol || pos.symbolName || '').replace(/-/g, '').toUpperCase();
      return size > 0 && posSymbol === cleanSymbol;
    });
  } catch (error) {
    log.error(`❌ Ошибка проверки позиции для ${symbol}: ${error.message}`);
    return false;
  }
}

// ============================================
//  ФИЛЬТРАЦИЯ СИГНАЛОВ ПО ПРИОРИТЕТУ
// ============================================
function filterSignalsByPriority(signals) {
  const priority = { high: 0, medium: 1 };
  return signals.sort((a, b) => (priority[a.confidence] || 2) - (priority[b.confidence] || 2));
}

// ============================================
//  РАСЧЁТ РАЗМЕРА ПОЗИЦИИ (5% ОТ БАЛАНСА)
// ============================================
function calculatePositionSizeByRisk(balance, entryPrice, stopLoss, leverage = 10) {
  if (!balance || balance <= 0) return 0;
  if (!entryPrice || entryPrice <= 0) return 0;
  if (!stopLoss || stopLoss <= 0) return 0;

  const riskAmount = balance * CONFIG.riskPercent;
  const priceDiff = Math.abs(entryPrice - stopLoss);
  if (priceDiff === 0) return 0;

  const rawSize = (riskAmount / priceDiff) * leverage;
  return Math.round(rawSize * 10000) / 10000;
}

// ============================================
//  ИСПОЛНЕНИЕ СДЕЛКИ
// ============================================
async function executeTrade(signal, balance) {
  try {
    log.info(`🚀 Открытие: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);

    if (!exchangeClient) throw new Error('Клиент не инициализирован');
    if (!balance || balance < CONFIG.minBalance) {
      throw new Error(`Недостаточно средств: ${balance || 0}`);
    }

    const candles = await getCandles(signal.symbol);
    const indicators = { atr: signal.atr || 0.02, rsi: signal.rsi || 50, macd: signal.macd || 0 };
    const levels = calculatePositionLevels(signal.symbol, signal.entry_price, candles, indicators, signal.side, { minRatio: 2.0 });
    
    log.info(`🎯 SL: ${levels.stopLoss} | TP: ${levels.takeProfit} | R/R: 1:${levels.ratio}`);

    const positionSize = calculatePositionSizeByRisk(
      balance,
      signal.entry_price,
      levels.stopLoss,
      CONFIG.leverage
    );

    if (!positionSize || positionSize <= 0) {
      log.warn(`⚠️ Размер позиции = 0, пропускаем ${signal.symbol}`);
      await updateSignalStatus(signal.id, 'failed', { error: 'Invalid position size' });
      return null;
    }

    log.info(`📊 Размер позиции: ${positionSize} (риск: ${(CONFIG.riskPercent * 100)}%)`);

    // ✅ УБИРАЕМ stopLoss и takeProfit из MARKET ордера
    const order = await exchangeClient.placeOrder({
      symbol: signal.symbol,
      side: signal.side,
      type: 'MARKET',
      quantity: positionSize,
      leverage: CONFIG.leverage,
      // stopLoss: levels.stopLoss,   // ❌ УБРАТЬ!
      // takeProfit: levels.takeProfit, // ❌ УБРАТЬ!
      positionSide: signal.side.toUpperCase()
    });

    if (order) {
      log.info(`✅ Сделка открыта: ${order.orderId || 'OK'}`);
      await updateSignalStatus(signal.id, 'executed', {
        order_id: order.orderId,
        stop_loss: levels.stopLoss,
        take_profit: levels.takeProfit,
        position_size: positionSize
      });
      return order;
    }

    return null;

  } catch (error) {
    log.error(`❌ Ошибка сделки: ${error.message}`);
    await updateSignalStatus(signal.id, 'failed', { error: error.message });
    return null;
  }
}

// ============================================
//  ОСНОВНОЙ ЦИКЛ
// ============================================
async function mainLoop() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    if (!exchangeClient) {
      log.info('🔧 Инициализация Exchange...');
      // ✅ ИСПРАВЛЕНО: передаём объект с ключами
      exchangeClient = getExchange('bingx', {
        apiKey: process.env.BINGX_API_KEY,
        secretKey: process.env.BINGX_SECRET_KEY
      });
      log.info('✅ Клиент инициализирован');
    }

    const balance = await exchangeClient.getBalance();
    if (!balance || balance < CONFIG.minBalance) {
      log.warn(`⚠️ Недостаточно средств: ${balance || 0} USDT (минимум ${CONFIG.minBalance})`);
      return;
    }

    const activePositions = await getActivePositions();
    const currentPositionsCount = activePositions.total;

    log.info(`📊 Текущие позиции: ${currentPositionsCount} / ${CONFIG.maxPositions}`);

    if (currentPositionsCount >= CONFIG.maxPositions) {
      log.info(`⏸️ Достигнут лимит позиций (${CONFIG.maxPositions})`);
      return;
    }

    const signals = await getPendingSignals();
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов');
      return;
    }

    const sortedSignals = filterSignalsByPriority(signals);
    let openedCount = 0;

    for (const signal of sortedSignals) {
      if (currentPositionsCount + openedCount >= CONFIG.maxPositions) {
        log.info(`⏸️ Лимит позиций достигнут (${CONFIG.maxPositions})`);
        break;
      }

      const hasPosition = await hasActivePositionForSymbol(signal.symbol);
      if (hasPosition) {
        log.info(`⏭️ Пропускаем ${signal.symbol} — уже есть позиция`);
        await updateSignalStatus(signal.id, 'skipped', { reason: 'Position already exists' });
        continue;
      }

      const result = await executeTrade(signal, balance);
      if (result) {
        openedCount++;
        log.info(`✅ Открыта сделка ${openedCount}/${CONFIG.maxPositions}: ${signal.symbol} ${signal.side}`);
      }
    }

    log.info(`✅ Цикл завершён. Открыто сделок: ${openedCount}`);

  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

// ============================================
//  ЗАПУСК
// ============================================
async function start() {
  log.info('🚀 Trade Executor Bot запущен (ПРЯМОЙ ДОСТУП К SUPABASE)');
  log.info(`📋 Интервал: ${CONFIG.checkInterval / 1000}с`);
  log.info(`📊 Макс. позиций: ${CONFIG.maxPositions}`);
  log.info(`📊 Риск на сделку: ${CONFIG.riskPercent * 100}%`);
  await mainLoop();
  setInterval(mainLoop, CONFIG.checkInterval);
  process.on('SIGINT', () => { log.info('🛑 Остановлен'); process.exit(0); });
  process.on('SIGTERM', () => { log.info('🛑 Остановлен'); process.exit(0); });
}

if (require.main === module) {
  start().catch(error => {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, getPendingSignals, executeTrade };