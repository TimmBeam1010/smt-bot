#!/usr/bin/env node

/**
 * Trade Executor Bot (СТАБИЛЬНАЯ ВЕРСИЯ)
 */

const { getExchange } = require('../../shared/exchanges');
const { calculatePositionSize, calculatePositionLevels } = require('../../shared/position-calculator');
const { calculateDynamicRisk, calculateDynamicLeverage, calculateVolatility } = require('../../shared/risk-manager');
const { TrailingStopManager } = require('../../shared/trailing-manager');
const { notifyTrade, notifyError } = require('../../shared/notifier');

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

const CONFIG = {
  userId: 11,
  maxPositions: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 10,
  minBalanceThreshold: 0.55,
  highOnlyThreshold: 0.50,
  trailingStopPercent: 0.02,
};

const supabaseUrl = 'https://sbpyuigmrqycqlrjlqqv.supabase.co';
const supabaseKey = 'sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd';

let exchangeClient = null;
let isProcessing = false;
let minOrderSizes = {};
let initialBalance = 0;
let trailingManager = new TrailingStopManager();

async function loadMinOrderSizes() {
  try {
    const contracts = await exchangeClient.getContracts();
    if (!contracts || !Array.isArray(contracts)) return;
    contracts.forEach(c => {
      if (c.symbol && c.tradeMinQuantity) {
        minOrderSizes[c.symbol] = parseFloat(c.tradeMinQuantity);
      }
    });
    log.info(`✅ Загружены минимальные размеры для ${Object.keys(minOrderSizes).length} символов`);
  } catch (error) {
    log.error(`Ошибка загрузки минимальных размеров: ${error.message}`);
  }
}

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

async function getPendingSignals() {
  try {
    log.info('📡 Запрос сигналов из Supabase...');
    const data = await supabaseRequest('GET', `signals?user_id=eq.${CONFIG.userId}&status=eq.pending&order=created_at.desc&limit=${CONFIG.maxSignalsPerRun}`);
    if (!Array.isArray(data)) {
      log.warn('Ответ не массив');
      return [];
    }
    log.info(`📊 Найдено ${data.length} ожидающих сигналов`);
    return data;
  } catch (error) {
    log.error(`Ошибка получения сигналов: ${error.message}`);
    return [];
  }
}

async function updateSignalStatus(signalId, status, data = {}) {
  try {
    const updateData = { status, executed_at: new Date().toISOString() };
    await supabaseRequest('PATCH', `signals?id=eq.${signalId}`, updateData);
    log.info(`Сигнал ${signalId} обновлен: ${status}`);
    return true;
  } catch (error) {
    log.error(`Ошибка обновления: ${error.message}`);
    return false;
  }
}

async function getCandles(symbol, timeframe = '5m', limit = 50) {
  try {
    if (!exchangeClient || typeof exchangeClient.getCandles !== 'function') {
      log.warn('Метод getCandles не найден');
      return [];
    }
    const cleanSymbol = String(symbol).trim();
    const candles = await exchangeClient.getCandles(cleanSymbol, timeframe, limit);
    log.info(`Получено ${candles?.length || 0} свечей для ${cleanSymbol}`);
    return candles || [];
  } catch (error) {
    log.error(`Ошибка свечей: ${error.message}`);
    return [];
  }
}

async function getActivePositions() {
  try {
    if (!exchangeClient) return { long: 0, short: 0, total: 0 };
    const positions = await exchangeClient.getPositions();
    let longCount = 0, shortCount = 0;
    if (positions && Array.isArray(positions)) {
      positions.forEach(pos => {
        const size = parseFloat(pos.size || pos.quantity || pos.amount || 0);
        const positionAmt = parseFloat(pos.positionAmt || 0);
        const actualSize = size > 0 ? size : positionAmt;
        if (actualSize > 0.0001) {
          const side = pos.side || pos.positionSide || (pos.positionAmt > 0 ? 'LONG' : 'SHORT');
          if (side === 'LONG' || side === 'BUY') {
            longCount++;
          } else if (side === 'SHORT' || side === 'SELL') {
            shortCount++;
          }
        }
      });
    }
    const total = longCount + shortCount;
    log.info(`📊 АКТУАЛЬНЫЕ ПОЗИЦИИ: LONG=${longCount}, SHORT=${shortCount}, ВСЕГО=${total}`);
    return { long: longCount, short: shortCount, total };
  } catch (error) {
    log.error(`Ошибка позиций: ${error.message}`);
    return { long: 0, short: 0, total: 0 };
  }
}

async function isValidSymbol(symbol) {
  try {
    const contracts = await exchangeClient.getContracts();
    if (!contracts || !Array.isArray(contracts)) return false;
    return contracts.some(c => c.symbol === symbol || c.displayName === symbol);
  } catch (error) {
    log.error(`Ошибка проверки символа: ${error.message}`);
    return false;
  }
}

async function filterSignalsByRisk(signals, currentBalance) {
  try {
    if (initialBalance === 0) {
      initialBalance = currentBalance;
      log.info(`💰 Начальный баланс: ${initialBalance} USDT`);
    }
    const balancePercent = currentBalance / initialBalance;
    log.info(`📊 Остаток: ${currentBalance} USDT (${(balancePercent * 100).toFixed(1)}%)`);

    if (balancePercent >= CONFIG.minBalanceThreshold) {
      log.info(`✅ Баланс > 55% — все сигналы разрешены`);
      return signals;
    }
    if (balancePercent >= CONFIG.highOnlyThreshold && balancePercent < CONFIG.minBalanceThreshold) {
      const highSignals = signals.filter(s => s.confidence === 'high');
      log.info(`⚠️ Баланс ${(balancePercent * 100).toFixed(1)}% — только HIGH`);
      return highSignals;
    }
    log.warn(`🚨 Баланс < 50% — СДЕЛКИ ОСТАНОВЛЕНЫ!`);
    return [];
  } catch (error) {
    log.error(`Ошибка фильтрации: ${error.message}`);
    return signals;
  }
}

async function executeTrade(signal) {
  try {
    const currentPositions = await getActivePositions();
    if (currentPositions.total >= CONFIG.maxPositions) {
      log.warn(`🚨 ЛИМИТ ДОСТИГНУТ! СДЕЛКА НЕ ОТКРЫТА!`);
      await updateSignalStatus(signal.id, 'failed');
      return null;
    }

    const symbol = String(signal.symbol).trim();
    if (!await isValidSymbol(symbol)) {
      log.warn(`Символ ${symbol} не поддерживается`);
      await updateSignalStatus(signal.id, 'failed');
      return null;
    }

    log.info(`🚀 Открытие: ${symbol} ${signal.side} @ ${signal.entry_price}`);
    if (!exchangeClient) throw new Error('Клиент не инициализирован');

    const balance = await exchangeClient.getBalance();
    log.info(`💰 Баланс: ${balance} USDT`);
    if (!balance || balance < 5) throw new Error(`Недостаточно средств: ${balance || 0} USDT`);

    const candles = await getCandles(symbol, '5m', 50);
    const volatility = calculateVolatility(candles);
    log.info(`📊 Волатильность: ${(volatility * 100).toFixed(2)}%`);

    const riskPercent = calculateDynamicRisk(symbol, volatility, balance);
    const leverage = calculateDynamicLeverage(symbol, volatility, balance);
    log.info(`📊 Риск: ${riskPercent}%, Плечо: ${leverage}x`);

    const entry = parseFloat(signal.entry_price);
    const indicators = { atr: signal.atr || 0.02, rsi: signal.rsi || 50, macd: signal.macd || 0 };

    const levels = calculatePositionLevels(symbol, entry, candles, indicators, signal.side, { minRatio: 2.0 });

    log.info('🎯 Рассчитанные уровни:');
    log.info(`   SL: ${levels.stopLoss} (риск: ${levels.risk})`);
    log.info(`   TP: ${levels.takeProfit} (прибыль: ${levels.reward})`);
    log.info(`   Risk/Reward: 1:${levels.ratio} ${levels.valid ? '✅' : '❌'}`);

    let positionSize = calculatePositionSize({
      balance, riskPercent, entryPrice: entry,
      stopLoss: levels.stopLoss, leverage
    });

    const minSize = minOrderSizes[symbol] || 0.001;
    if (positionSize < minSize) {
      log.warn(`⚠️ Размер ${positionSize} меньше ${minSize}, увеличиваем...`);
      positionSize = minSize;
    }

    if (!positionSize || positionSize <= 0) throw new Error(`Некорректный размер: ${positionSize}`);

    const sideMap = { 'LONG': 'BUY', 'SHORT': 'SELL' };
    const orderSide = sideMap[signal.side.toUpperCase()];

    const order = await exchangeClient.placeOrder({
      symbol: symbol,
      side: orderSide,
      type: 'MARKET',
      quantity: positionSize,
      leverage: leverage,
      positionSide: signal.side.toUpperCase()
    });

    if (!order) throw new Error('Ордер не был создан');

    log.info(`✅ Позиция открыта: ${order.orderId || 'OK'}`);

    const tpslResults = await exchangeClient.setTPSL(
      order.orderId,
      symbol,
      orderSide,
      positionSize,
      levels.stopLoss,
      levels.takeProfit
    );

    if (tpslResults) {
      tpslResults.forEach(result => {
        if (result.status === 'success') {
          log.info(`✅ ${result.type} установлен`);
        } else {
          log.warn(`⚠️ ${result.type} не установлен: ${result.error?.msg || 'unknown error'}`);
        }
      });
    }

    await updateSignalStatus(signal.id, 'executed');
    return order;

  } catch (error) {
    log.error(`❌ Ошибка сделки: ${error.message}`);
    await updateSignalStatus(signal.id, 'failed');
    throw error;
  }
}

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
      await loadMinOrderSizes();
    }

    const currentBalance = await exchangeClient.getBalance();
    if (!currentBalance) {
      log.warn('⚠️ Не удалось получить баланс');
      return;
    }

    const positions = await getActivePositions();
    log.info(`📊 АКТУАЛЬНЫХ ПОЗИЦИЙ: ${positions.total} из ${CONFIG.maxPositions}`);

    if (positions.total >= CONFIG.maxPositions) {
      log.warn(`🚨 ДОСТИГНУТ ЛИМИТ! НОВЫЕ СДЕЛКИ НЕ ОТКРЫВАЮТСЯ!`);
      return;
    }

    let signals = await getPendingSignals();
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов');
      return;
    }

    signals = await filterSignalsByRisk(signals, currentBalance);
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов по риск-параметрам');
      return;
    }

    let opened = 0;
    for (const signal of signals) {
      if (opened >= CONFIG.maxPositions - positions.total) break;
      const result = await executeTrade(signal);
      if (result) opened++;
    }

    log.info(`✅ Открыто ${opened} новых позиций в этом цикле`);

  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

async function start() {
  log.info('🚀 Trade Executor Bot запущен (СТАБИЛЬНАЯ ВЕРСИЯ)');
  log.info(`📋 Максимум позиций: ${CONFIG.maxPositions}`);
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
