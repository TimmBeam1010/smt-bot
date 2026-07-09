#!/usr/bin/env node

const { getExchange } = require('../../shared/exchanges');
const { calculatePositionSize, calculatePositionLevels } = require('../../shared/position-calculator');
const { createClient } = require('@supabase/supabase-js');

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

const CONFIG = {
  maxPositions: 1,
  riskPercent: 0.3,
  leverage: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 5
};

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://sbpyuigmrqycqlrjlqqv.supabase.co',
  process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNicHl1aWdtcnF5Y3FscmpscXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjI4Nzc4MCwiZXhwIjoyMDk3ODYzNzgwfQ.g3C8YdCKmo53tSYLFMAv1YXh2OFsm7DZvKeIMGpnkT0',
  { realtime: false }
);

let exchangeClient = null;
let isProcessing = false;

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

async function getCandles(symbol) {
  try {
    if (!exchangeClient) return [];
    return await exchangeClient.getCandles({ symbol, interval: '5m', limit: 100 }) || [];
  } catch (error) {
    log.error(`❌ Ошибка свечей: ${error.message}`);
    return [];
  }
}

async function getActivePositions() {
  try {
    if (!exchangeClient) return { long: 0, short: 0 };
    const positions = await exchangeClient.getPositions();
    let long = 0, short = 0;
    if (positions && Array.isArray(positions)) {
      positions.forEach(pos => {
        const size = parseFloat(pos.size || pos.quantity || 0);
        if (size > 0) {
          if (pos.side === 'LONG' || pos.positionSide === 'LONG') long++;
          else if (pos.side === 'SHORT' || pos.positionSide === 'SHORT') short++;
        }
      });
    }
    return { long, short };
  } catch (error) {
    log.error(`❌ Ошибка позиций: ${error.message}`);
    return { long: 0, short: 0 };
  }
}

async function executeTrade(signal) {
  try {
    log.info(`🚀 Открытие: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);
    if (!exchangeClient) throw new Error('Клиент не инициализирован');
    const balance = await exchangeClient.getBalance();
    log.info(`💰 Баланс: ${balance} USDT`);
    if (!balance || balance < 10) throw new Error(`Недостаточно средств: ${balance || 0}`);
    const candles = await getCandles(signal.symbol);
    const indicators = { atr: signal.atr || 0.02, rsi: signal.rsi || 50, macd: signal.macd || 0 };
    const levels = calculatePositionLevels(signal.symbol, signal.entry_price, candles, indicators, signal.side, { minRatio: 2.0 });
    log.info(`🎯 SL: ${levels.stopLoss} | TP: ${levels.takeProfit} | R/R: 1:${levels.ratio}`);
    const positionSize = calculatePositionSize({
      balance,
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
    await updateSignalStatus(signal.id, 'executed', { order_id: order.orderId, stop_loss: levels.stopLoss, take_profit: levels.takeProfit });
    return order;
  } catch (error) {
    log.error(`❌ Ошибка сделки: ${error.message}`);
    await updateSignalStatus(signal.id, 'failed', { error: error.message });
    throw error;
  }
}

async function mainLoop() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    if (!exchangeClient) {
      log.info('🔧 Инициализация Exchange...');
      exchangeClient = getExchange('bingx', process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
      log.info('✅ Клиент инициализирован');
    }
    const signals = await getPendingSignals();
    if (signals.length === 0) { log.debug('📭 Нет сигналов'); return; }
    log.info(`📨 Найдено ${signals.length} сигналов`);
    const positions = await getActivePositions();
    log.info(`📊 Позиции: LONG=${positions.long}, SHORT=${positions.short}`);
    for (const signal of signals) {
      const side = signal.side.toUpperCase();
      if (side === 'LONG' && positions.long >= CONFIG.maxPositions) { log.info(`⏸️ Пропускаем LONG`); continue; }
      if (side === 'SHORT' && positions.short >= CONFIG.maxPositions) { log.info(`⏸️ Пропускаем SHORT`); continue; }
      await executeTrade(signal);
    }
  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

async function start() {
  log.info('🚀 Trade Executor Bot запущен (ПРЯМОЙ ДОСТУП К SUPABASE)');
  log.info(`📋 Интервал: ${CONFIG.checkInterval / 1000}с`);
  await mainLoop();
  setInterval(mainLoop, CONFIG.checkInterval);
  process.on('SIGINT', () => { log.info('🛑 Остановлен'); process.exit(0); });
  process.on('SIGTERM', () => { log.info('🛑 Остановлен'); process.exit(0); });
}

if (require.main === module) {
  start().catch(error => { console.error(`❌ Критическая ошибка: ${error.message}`); process.exit(1); });
}

module.exports = { start, getPendingSignals, executeTrade };