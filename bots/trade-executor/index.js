// ============================================
//  КОНФИГУРАЦИЯ ТОРГОВЛИ
// ============================================
const CONFIG = {
  maxPositions: 10,               // Максимум открытых позиций
  riskPercent: 0.05,             // 5% от депозита на сделку
  leverage: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 20,
  minBalance: 10,
};

// ============================================
//  ПОЛУЧЕНИЕ БАЛАНСА (уже есть)
// ============================================

// ============================================
//  ФИЛЬТРАЦИЯ СИГНАЛОВ ПО ПРИОРИТЕТУ
// ============================================
function filterSignalsByPriority(signals) {
  // Сортируем: сначала high, потом medium
  const priority = { high: 0, medium: 1 };
  return signals.sort((a, b) => (priority[a.confidence] || 2) - (priority[b.confidence] || 2));
}

// ============================================
//  ПРОВЕРКА, ЕСТЬ ЛИ УЖЕ СДЕЛКА ПО ЭТОЙ МОНЕТЕ
// ============================================
async function hasActivePositionForSymbol(symbol) {
  try {
    const positions = await exchangeClient.getPositions();
    if (!positions || !Array.isArray(positions)) return false;

    // Проверяем, есть ли открытая позиция по этому символу
    return positions.some(pos => {
      const size = parseFloat(pos.size || pos.quantity || 0);
      const posSymbol = pos.symbol || pos.symbolName || '';
      return size > 0 && posSymbol.replace(/-/g, '').toUpperCase() === symbol.replace(/-/g, '').toUpperCase();
    });
  } catch (error) {
    log.error(`❌ Ошибка проверки позиции для ${symbol}: ${error.message}`);
    return false;
  }
}

// ============================================
//  РАСЧЁТ РАЗМЕРА ПОЗИЦИИ (5% ОТ БАЛАНСА)
// ============================================
function calculatePositionSizeByRisk(balance, entryPrice, stopLoss, leverage = 10) {
  if (!balance || balance <= 0) return 0;
  if (!entryPrice || entryPrice <= 0) return 0;
  if (!stopLoss || stopLoss <= 0) return 0;

  // Сумма риска (5% от баланса)
  const riskAmount = balance * CONFIG.riskPercent;

  // Разница между входом и стоп-лоссом
  const priceDiff = Math.abs(entryPrice - stopLoss);
  if (priceDiff === 0) return 0;

  // Размер позиции с учётом плеча
  const rawSize = (riskAmount / priceDiff) * leverage;

  // Округляем до 4 знаков (для USDT-пар)
  return Math.round(rawSize * 10000) / 10000;
}

// ============================================
//  ОСНОВНОЙ ЦИКЛ (С ПРИОРИТЕТАМИ)
// ============================================
async function mainLoop() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    if (!exchangeClient) {
      log.info('🔧 Инициализация Exchange...');
      exchangeClient = getExchange('bingx', process.env.BINGX_API_KEY, process.env.BINGX_SECRET_KEY);
      log.info('✅ Клиент инициализирован');
    }

    // 1. Получаем баланс
    const balance = await exchangeClient.getBalance();
    if (!balance || balance < CONFIG.minBalance) {
      log.warn(`⚠️ Недостаточно средств: ${balance || 0} USDT (минимум ${CONFIG.minBalance})`);
      return;
    }

    // 2. Получаем активные позиции
    const positions = await exchangeClient.getPositions();
    const activePositions = positions.filter(p => parseFloat(p.size || p.quantity || 0) > 0);
    const currentPositionsCount = activePositions.length;

    log.info(`📊 Текущие позиции: ${currentPositionsCount} / ${CONFIG.maxPositions}`);

    // 3. Если лимит достигнут — выходим
    if (currentPositionsCount >= CONFIG.maxPositions) {
      log.info(`⏸️ Достигнут лимит позиций (${CONFIG.maxPositions})`);
      return;
    }

    // 4. Получаем сигналы
    const signals = await getPendingSignals();
    if (signals.length === 0) {
      log.debug('📭 Нет сигналов');
      return;
    }

    // 5. Фильтруем по приоритету (High → Medium)
    const sortedSignals = filterSignalsByPriority(signals);

    let openedCount = 0;
    for (const signal of sortedSignals) {
      // Проверяем, не превышен ли лимит
      if (currentPositionsCount + openedCount >= CONFIG.maxPositions) {
        log.info(`⏸️ Лимит позиций достигнут (${CONFIG.maxPositions})`);
        break;
      }

      // Проверяем, есть ли уже позиция по этой монете
      const hasPosition = await hasActivePositionForSymbol(signal.symbol);
      if (hasPosition) {
        log.info(`⏭️ Пропускаем ${signal.symbol} — уже есть позиция`);
        await updateSignalStatus(signal.id, 'skipped', { reason: 'Position already exists' });
        continue;
      }

      // Открываем сделку
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
//  ИСПОЛНЕНИЕ СДЕЛКИ (С РАСЧЁТОМ 5%)
// ============================================
async function executeTrade(signal, balance) {
  try {
    log.info(`🚀 Открытие: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);

    // Получаем свечи для расчёта ATR
    const candles = await getCandles(signal.symbol);
    const indicators = { atr: signal.atr || 0.02, rsi: signal.rsi || 50, macd: signal.macd || 0 };

    // Рассчитываем уровни (SL/TP)
    const levels = calculatePositionLevels(signal.symbol, signal.entry_price, candles, indicators, signal.side, { minRatio: 2.0 });
    log.info(`🎯 SL: ${levels.stopLoss} | TP: ${levels.takeProfit} | R/R: 1:${levels.ratio}`);

    // Рассчитываем размер позиции (5% от баланса)
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

    // Отправляем ордер
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