#!/usr/bin/env node

const { getExchange } = require("../../shared/exchanges");
const { TrailingStopManager } = require("../../shared/trailing-manager");

// ============================================
//  ЛОГГЕР
// ============================================
const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

// ============================================
//  КОНФИГУРАЦИЯ
// ============================================
const CONFIG = {
  userId: 11,                        
  maxPositions: 10,                  
  checkInterval: 30000,              
  maxSignalsPerRun: 10,              
  minBalanceThreshold: 0.55,         
  highOnlyThreshold: 0.50,           
  trailingStopPercent: 0.02,         
  positionSizePercent: 0.05,         
  defaultLeverage: 30,               
};

const supabaseUrl = 'https://sbpyuigmrqycqlrjlqqv.supabase.co';
const supabaseKey = 'sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd';

let exchangeClient = null;
let isProcessing = false;
let minOrderSizes = {};
let initialBalance = 0;
let trailingManager = new TrailingStopManager();

// ============================================
//  SUPABASE
// ============================================
async function supabaseRequest(method, endpoint, data = null) {
  const url = `${supabaseUrl}/rest/v1/${endpoint}`;
  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
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

// ============================================
//  ЗАГРУЗКА МИНИМАЛЬНЫХ РАЗМЕРОВ
// ============================================
async function loadMinOrderSizes() {
  try {
    if (!exchangeClient) return;
    const contracts = await exchangeClient.getContracts();
    if (!contracts || !Array.isArray(contracts)) return;
    for (const c of contracts) {
      if (c.symbol) {
        minOrderSizes[c.symbol] = parseFloat(c.minQty) || 0;
      }
    }
    log.info(`📊 Загружены минимальные размеры для ${Object.keys(minOrderSizes).length} символов`);
  } catch (error) {
    log.warn(`⚠️ Не удалось загрузить минимальные размеры: ${error.message}`);
  }
}

// ============================================
//  ПОЛУЧЕНИЕ БАЛАНСА
// ============================================
async function getBalance() {
  try {
    if (!exchangeClient) return 0;
    const balance = await exchangeClient.getBalance();
    return parseFloat(balance) || 0;
  } catch (error) {
    log.error(`Ошибка получения баланса: ${error.message}`);
    return 0;
  }
}

// ============================================
//  ПОЛУЧЕНИЕ СВЕЧЕЙ
// ============================================
async function getCandles(symbol, interval = '5m', limit = 50) {
  try {
    if (!exchangeClient) return [];
    return await exchangeClient.getCandles(symbol, interval, limit);
  } catch (error) {
    log.error(`Ошибка получения свечей: ${error.message}`);
    return [];
  }
}

// ============================================
//  ПОЛУЧЕНИЕ АКТИВНЫХ ПОЗИЦИЙ
// ============================================
async function getActivePositions() {
  try {
    if (!exchangeClient) return { total: 0, positions: [] };
    const positions = await exchangeClient.getPositions();
    const active = positions.filter(p => parseFloat(p.positionAmt) !== 0);
    const longs = active.filter(p => p.positionSide === 'LONG');
    const shorts = active.filter(p => p.positionSide === 'SHORT');
    return {
      total: active.length,
      longs: longs.length,
      shorts: shorts.length,
      positions: active
    };
  } catch (error) {
    log.error(`Ошибка получения позиций: ${error.message}`);
    return { total: 0, positions: [] };
  }
}

// ============================================
//  ПРОВЕРКА СИМВОЛА
// ============================================
async function isValidSymbol(symbol) {
  if (!symbol) return false;
  const s = String(symbol).trim().toUpperCase();
  return Object.keys(minOrderSizes).some(key => key.toUpperCase() === s);
}

// ============================================
//  ПОЛУЧЕНИЕ ОЖИДАЮЩИХ СИГНАЛОВ
// ============================================
async function getPendingSignals() {
  try {
    const data = await supabaseRequest('GET', 
      `signals?user_id=eq.${CONFIG.userId}&status=eq.pending&order=created_at.desc&limit=${CONFIG.maxSignalsPerRun}`
    );
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

// ============================================
//  ОБНОВЛЕНИЕ СТАТУСА СИГНАЛА
// ============================================
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

// ============================================
//  РАСЧЁТ РАЗМЕРА ПОЗИЦИИ
// ============================================
function calculatePositionSize(entryPrice, symbol) {
  const riskAmount = initialBalance * CONFIG.positionSizePercent;
  let quantity = riskAmount / entryPrice;
  const minQty = minOrderSizes[symbol] || 0;
  if (minQty > 0 && quantity < minQty) {
    log.warn(`⚠️ Размер ${quantity} меньше минимального ${minQty} для ${symbol}, устанавливаем минимум`);
    quantity = minQty;
  }
  quantity = Math.floor(quantity * 1e8) / 1e8;
  log.info(`💰 Расчёт: $${riskAmount.toFixed(2)} (5% от $${initialBalance.toFixed(2)}) → ${quantity} ${symbol}`);
  return quantity;
}

// ============================================
//  РАСЧЁТ TP/SL
// ============================================
function calculateTPSL(entryPrice, side, leverage) {
  const riskPercent = 0.02;
  const rewardRatio = 2;
  const slDistance = entryPrice * riskPercent;
  const tpDistance = slDistance * rewardRatio;
  
  let stopLoss, takeProfit;
  if (side === 'LONG') {
    stopLoss = entryPrice - slDistance;
    takeProfit = entryPrice + tpDistance;
  } else {
    stopLoss = entryPrice + slDistance;
    takeProfit = entryPrice - tpDistance;
  }
  
  const liqPrice = side === 'LONG' 
    ? entryPrice * (1 - 1/leverage) 
    : entryPrice * (1 + 1/leverage);
  
  if (side === 'LONG' && stopLoss <= liqPrice) {
    stopLoss = liqPrice * 1.02;
  }
  if (side === 'SHORT' && stopLoss >= liqPrice) {
    stopLoss = liqPrice * 0.98;
  }
  
  return { stopLoss, takeProfit, liqPrice };
}

// ============================================
//  ФИЛЬТР СИГНАЛОВ
// ============================================
function filterSignalsByConfidence(signals) {
  const highSignals = signals.filter(s => s.confidence === 'high');
  if (highSignals.length > 0) {
    log.info(`🔍 Приоритет HIGH: ${highSignals.length} сигналов`);
    return highSignals;
  }
  const mediumSignals = signals.filter(s => s.confidence === 'medium');
  if (mediumSignals.length > 0) {
    log.info(`🔍 HIGH нет, берём ${mediumSignals.length} MEDIUM сигналов`);
    return mediumSignals;
  }
  return [];
}

// ============================================
//  ФИЛЬТР ПО РИСКУ
// ============================================
function filterSignalsByRisk(signals, balance) {
  if (initialBalance === 0) return [];
  const balancePercent = balance / initialBalance;
  if (balancePercent >= CONFIG.minBalanceThreshold) {
    return signals;
  }
  if (balancePercent >= CONFIG.highOnlyThreshold) {
    return signals.filter(s => s.confidence === 'high');
  }
  return [];
}

// ============================================
//  ИСПОЛНЕНИЕ СДЕЛКИ
// ============================================
async function executeTrade(signal) {
  try {
    const currentPositions = await getActivePositions();
    if (currentPositions.total >= CONFIG.maxPositions) {
      log.warn(`🚨 ЛИМИТ ДОСТИГНУТ!`);
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

    const balance = await getBalance();
    if (!balance || balance < 5) throw new Error(`Недостаточно средств`);

    const quantity = calculatePositionSize(signal.entry_price, symbol);
    const leverage = CONFIG.defaultLeverage;

    const { stopLoss, takeProfit, liqPrice } = calculateTPSL(
      signal.entry_price, 
      signal.side, 
      leverage
    );

    log.info(`🎯 TP: $${takeProfit.toFixed(4)} | SL: $${stopLoss.toFixed(4)}`);

    const side = signal.side === 'LONG' ? 'BUY' : 'SELL';
    const positionSide = signal.side;

    // ============================================
    //  ШАГ 1: РЫНОЧНЫЙ ОРДЕР
    // ============================================
    const marketOrder = {
      symbol: symbol,
      side: side,
      positionSide: positionSide,
      type: 'MARKET',
      quantity: quantity,
      leverage: leverage,
    };

    const result = await exchangeClient.placeOrder(marketOrder);
    log.info(`✅ Сделка открыта: ${symbol} ${signal.side} | Размер: ${quantity}`);

    await new Promise(resolve => setTimeout(resolve, 1000));

    // ============================================
    //  ШАГ 2: TP И SL ЧЕРЕЗ setTPSL
    // ============================================
    log.info(`🎯 Установка TP: $${takeProfit.toFixed(4)} | SL: $${stopLoss.toFixed(4)}`);

    try {
      const tpslResult = await exchangeClient.setTPSL(
        result?.orderId || 'N/A',
        symbol,
        side,
        quantity,
        stopLoss,
        takeProfit
      );
      if (tpslResult && tpslResult.length > 0) {
        const success = tpslResult.filter(r => r.status === 'success').map(r => r.type);
        const failed = tpslResult.filter(r => r.status === 'failed').map(r => r.type);
        if (success.length > 0) log.info(`✅ Установлены: ${success.join(', ')}`);
        if (failed.length > 0) log.warn(`⚠️ Не установлены: ${failed.join(', ')}`);
      }
    } catch (error) {
      log.warn(`⚠️ Ошибка установки TP/SL: ${error.message}`);
    }

    await updateSignalStatus(signal.id, 'executed', { 
      executed_price: signal.entry_price,
      quantity: quantity,
      order_id: result?.orderId || 'N/A',
      take_profit: takeProfit,
      stop_loss: stopLoss,
    });

    trailingManager.update(symbol, signal.entry_price, signal.side, signal.entry_price, CONFIG.trailingStopPercent);

    return result;
  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
    await updateSignalStatus(signal.id, 'failed');
    return null;
  }
}

// ============================================
//  ГЛАВНЫЙ ЦИКЛ
// ============================================
async function mainLoop() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const currentBalance = await getBalance();
    if (currentBalance === 0) {
      isProcessing = false;
      return;
    }

    if (initialBalance === 0) {
      initialBalance = currentBalance;
      log.info(`💰 Депозит: $${initialBalance.toFixed(2)}`);
    }

    const positions = await getActivePositions();
    log.info(`📊 ПОЗИЦИЙ: ${positions.total} из ${CONFIG.maxPositions}`);

    if (positions.total >= CONFIG.maxPositions) {
      isProcessing = false;
      return;
    }

    let signals = await getPendingSignals();
    if (signals.length === 0) {
      isProcessing = false;
      return;
    }

    signals = filterSignalsByConfidence(signals);
    if (signals.length === 0) {
      isProcessing = false;
      return;
    }

    signals = filterSignalsByRisk(signals, currentBalance);
    if (signals.length === 0) {
      isProcessing = false;
      return;
    }

    let opened = 0;
    for (const signal of signals) {
      if (opened >= CONFIG.maxPositions - positions.total) break;
      const result = await executeTrade(signal);
      if (result) opened++;
    }

    log.info(`✅ Открыто ${opened} позиций`);

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
  log.info('🚀 Trade Executor Bot запущен');
  log.info(`💰 Размер сделки: 5% от депозита`);
  log.info(`📊 Приоритет: HIGH → MEDIUM`);
  log.info(`🛡️ TP/SL: setTPSL (STOP_MARKET + TAKE_PROFIT_MARKET)`);
  
  exchangeClient = getExchange("bingx",
    process.env.BINGX_API_KEY || "BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A",
    process.env.BINGX_SECRET_KEY || "jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA"
  );
  log.info('✅ Клиент инициализирован');

  await loadMinOrderSizes();
  
  const balance = await getBalance();
  initialBalance = balance;
  log.info(`💰 Депозит: $${initialBalance.toFixed(2)}`);
  
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