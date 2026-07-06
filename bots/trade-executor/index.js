#!/usr/bin/env node

const { getExchange } = require("../../shared/exchanges");
const { TrailingStopManager } = require("../../shared/trailing-manager");

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

// ========================================
//  КОНФИГУРАЦИЯ
// ========================================
const CONFIG = {
  userId: 11,                        // ID пользователя для сигналов
  maxPositions: 10,                  // Максимум открытых позиций
  checkInterval: 30000,              // Интервал проверки (30 сек)
  maxSignalsPerRun: 10,              // Максимум сигналов за один цикл
  minBalanceThreshold: 0.55,         // 55% — только HIGH сигналы
  highOnlyThreshold: 0.50,           // 50% — ниже этого останавливаем
  trailingStopPercent: 0.02,         // Трейлинг-стоп 2%
  positionSizePercent: 0.05,         // 🔥 5% от депозита на сделку
  confidenceLevel: 'high',           // 🔥 ТОЛЬКО HIGH сигналы
};

const supabaseUrl = 'https://sbpyuigmrqycqlrjlqqv.supabase.co';
const supabaseKey = 'sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd';

let exchangeClient = null;
let isProcessing = false;
let minOrderSizes = {};
let initialBalance = 0;
let trailingManager = new TrailingStopManager();

// ========================================
//  SUPABASE
// ========================================
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

// ========================================
//  ЗАГРУЗКА МИНИМАЛЬНЫХ РАЗМЕРОВ
// ========================================
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

// ========================================
//  ПОЛУЧЕНИЕ БАЛАНСА
// ========================================
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

// ========================================
//  ПОЛУЧЕНИЕ СВЕЧЕЙ
// ========================================
async function getCandles(symbol, interval = '5m', limit = 50) {
  try {
    if (!exchangeClient) return [];
    return await exchangeClient.getCandles(symbol, interval, limit);
  } catch (error) {
    log.error(`Ошибка получения свечей: ${error.message}`);
    return [];
  }
}

// ========================================
//  ПОЛУЧЕНИЕ АКТИВНЫХ ПОЗИЦИЙ
// ========================================
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

// ========================================
//  ПРОВЕРКА СИМВОЛА
// ========================================
async function isValidSymbol(symbol) {
  if (!symbol) return false;
  const s = String(symbol).trim().toUpperCase();
  return Object.keys(minOrderSizes).some(key => key.toUpperCase() === s);
}

// ========================================
//  ПОЛУЧЕНИЕ ОЖИДАЮЩИХ СИГНАЛОВ
// ========================================
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

// ========================================
//  ОБНОВЛЕНИЕ СТАТУСА СИГНАЛА
// ========================================
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

// ========================================
//  🔥 РАСЧЁТ РАЗМЕРА ПОЗИЦИИ (5% ОТ ДЕПОЗИТА)
// ========================================
function calculatePositionSize(balance, entryPrice, symbol) {
  // 5% от баланса
  const riskAmount = balance * CONFIG.positionSizePercent;
  
  // Количество токенов
  let quantity = riskAmount / entryPrice;
  
  // Проверка минимального размера
  const minQty = minOrderSizes[symbol] || 0;
  if (minQty > 0 && quantity < minQty) {
    log.warn(`⚠️ Размер ${quantity} меньше минимального ${minQty} для ${symbol}, устанавливаем минимум`);
    quantity = minQty;
  }
  
  // Округление до 8 знаков
  quantity = Math.floor(quantity * 1e8) / 1e8;
  
  log.info(`💰 Расчёт: баланс $${balance.toFixed(2)} × 5% = $${riskAmount.toFixed(2)} → ${quantity} ${symbol}`);
  return quantity;
}

// ========================================
//  🔥 ФИЛЬТР СИГНАЛОВ (ТОЛЬКО HIGH)
// ========================================
function filterHighConfidenceSignals(signals) {
  const filtered = signals.filter(s => s.confidence === CONFIG.confidenceLevel);
  log.info(`🔍 Фильтр HIGH: ${filtered.length} из ${signals.length} сигналов`);
  return filtered;
}

// ========================================
//  ФИЛЬТР ПО РИСКУ
// ========================================
function filterSignalsByRisk(signals, balance) {
  const balancePercent = balance / initialBalance;
  if (balancePercent >= CONFIG.minBalanceThreshold) {
    log.info(`✅ Баланс > 55% — все HIGH сигналы разрешены`);
    return signals;
  }
  if (balancePercent >= CONFIG.highOnlyThreshold && balancePercent < CONFIG.minBalanceThreshold) {
    const highSignals = signals.filter(s => s.confidence === 'high');
    log.info(`⚠️ Баланс ${(balancePercent * 100).toFixed(1)}% — только HIGH`);
    return highSignals;
  }
  log.warn(`🚨 Баланс < 50% — СДЕЛКИ ОСТАНОВЛЕНЫ!`);
  return [];
}

// ========================================
//  ИСПОЛНЕНИЕ СДЕЛКИ
// ========================================
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

    const balance = await getBalance();
    if (!balance || balance < 5) throw new Error(`Недостаточно средств: ${balance || 0} USDT`);

    // 🔥 РАСЧЁТ РАЗМЕРА (5% ОТ ДЕПОЗИТА)
    const quantity = calculatePositionSize(balance, signal.entry_price, symbol);

    const side = signal.side === 'LONG' ? 'BUY' : 'SELL';
    const positionSide = signal.side;

    // Используем рыночный ордер
    const order = {
      symbol: symbol,
      side: side,
      positionSide: positionSide,
      type: 'MARKET',
      quantity: quantity,
      leverage: 10, // Плечо можно настроить
    };

    log.info(`📤 Параметры ордера: ${JSON.stringify(order, null, 2)}`);

    const result = await exchangeClient.placeOrder(order);
    log.info(`✅ Сделка открыта: ${symbol} ${signal.side} | Размер: ${quantity}`);

    // Обновляем статус сигнала
    await updateSignalStatus(signal.id, 'executed', { 
      executed_price: signal.entry_price,
      quantity: quantity,
      order_id: result?.orderId || 'N/A'
    });

    // Инициализируем трейлинг-стоп
    trailingManager.update(symbol, signal.entry_price, signal.side, signal.entry_price, CONFIG.trailingStopPercent);

    return result;
  } catch (error) {
    log.error(`❌ Ошибка открытия сделки: ${error.message}`);
    await updateSignalStatus(signal.id, 'failed');
    return null;
  }
}

// ========================================
//  ГЛАВНЫЙ ЦИКЛ
// ========================================
async function mainLoop() {
  if (isProcessing) {
    log.debug('⏳ Уже обрабатывается...');
    return;
  }

  isProcessing = true;
  try {
    const currentBalance = await getBalance();
    if (currentBalance === 0) {
      log.warn('⚠️ Баланс недоступен или равен 0');
      isProcessing = false;
      return;
    }

    if (initialBalance === 0) {
      initialBalance = currentBalance;
      log.info(`💰 Начальный баланс: $${initialBalance.toFixed(2)}`);
    }

    const positions = await getActivePositions();
    log.info(`📊 АКТУАЛЬНЫХ ПОЗИЦИЙ: ${positions.total} из ${CONFIG.maxPositions}`);

    if (positions.total >= CONFIG.maxPositions) {
      log.warn(`🚨 ДОСТИГНУТ ЛИМИТ! НОВЫЕ СДЕЛКИ НЕ ОТКРЫВАЮТСЯ!`);
      isProcessing = false;
      return;
    }

    let signals = await getPendingSignals();
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов');
      isProcessing = false;
      return;
    }

    // 🔥 ФИЛЬТР: ТОЛЬКО HIGH
    signals = filterHighConfidenceSignals(signals);
    if (signals.length === 0) {
      log.debug('📭 Нет HIGH сигналов');
      isProcessing = false;
      return;
    }

    // Фильтр по риску
    signals = filterSignalsByRisk(signals, currentBalance);
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов по риск-параметрам');
      isProcessing = false;
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

// ========================================
//  ЗАПУСК
// ========================================
async function start() {
  log.info('🚀 Trade Executor Bot запущен (СТАБИЛЬНАЯ ВЕРСИЯ)');
  log.info(`📋 Максимум позиций: ${CONFIG.maxPositions}`);
  log.info(`📋 Интервал: ${CONFIG.checkInterval / 1000}с`);
  log.info(`💰 Размер сделки: ${CONFIG.positionSizePercent * 100}% от депозита`);
  log.info(`🔒 Уровень сигнала: ${CONFIG.confidenceLevel.toUpperCase()}`);
  
  exchangeClient = getExchange("bingx",
    process.env.BINGX_API_KEY || "BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A",
    process.env.BINGX_SECRET_KEY || "jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA"
  );
  log.info('✅ Клиент инициализирован');

  await loadMinOrderSizes();
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