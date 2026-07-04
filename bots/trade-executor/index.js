#!/usr/bin/env node

/**
 * Trade Executor Bot
 * 
 * Отвечает за:
 * 1. Получение сигналов из базы данных
 * 2. Проверку наличия открытых позиций
 * 3. Открытие сделок на BingX
 * 4. Управление рисками (SL/TP)
 * 5. Логирование всех действий
 */

const { createClient } = require('@supabase/supabase-js');
const { createExchangeClient } = require('../../shared/exchanges');
const { calculatePositionSize, calculateTPSL } = require('../../shared/position-calculator');
const logger = require('../../shared/logger');
const notifier = require('../../shared/notifier');

// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
  userId: 11, // Пользователь trnabiev@gmail.com
  maxPositions: 1, // Максимум 1 LONG и 1 SHORT одновременно
  riskPercent: 0.3, // 0.3% риска на сделку
  leverage: 10, // Плечо 10x
  checkInterval: 30000, // Проверка каждые 30 секунд
  maxSignalsPerRun: 5, // Максимум сигналов за один раз
};

// ===== ИНИЦИАЛИЗАЦИЯ =====
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://zqyalsprnbbjifjctdga.supabase.co',
  process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxeWFsc3BybmJiamlmamN0ZGdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3OTk1MTgsImV4cCI6MjA1NzM3NTUxOH0.0Nt8hM5eZk7yjmjG2OV-5iDQBW0Z0aJQqg5CdIHEZUI'
);

let exchangeClient = null;
let isProcessing = false;

// ===== ФУНКЦИЯ ПОЛУЧЕНИЯ СИГНАЛОВ (С FALLBACK) =====
async function getPendingSignals(userId = 11) {
  try {
    logger.info(`[trade-executor] 📡 Запрос сигналов для user_id=${userId}...`);
    
    // ===== СПОСОБ 1: ЧЕРЕЗ REST API (ОБХОД TIMEOUT) =====
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('https://smtbot.com/api/signals/user/trnabiev@gmail.com', {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`API вернул статус ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!Array.isArray(data)) {
        throw new Error('API вернул не массив');
      }
      
      // Фильтруем только pending сигналы
      const pending = data.filter(s => s.status === 'pending');
      
      logger.info(`[trade-executor] ✅ Через API получено ${pending.length} ожидающих сигналов`);
      
      // Сортируем по дате (сначала новые)
      pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      // Берём только первые N сигналов
      return pending.slice(0, CONFIG.maxSignalsPerRun);
      
    } catch (apiError) {
      logger.warn(`[trade-executor] ⚠️ API метод не сработал: ${apiError.message}`);
      
      // ===== СПОСОБ 2: ПРЯМОЙ ЗАПРОС К SUPABASE С ТАЙМАУТОМ =====
      try {
        logger.info('[trade-executor] 🔄 Пробуем прямой запрос к Supabase...');
        
        // Создаём Promise с таймаутом
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Supabase timeout (8s)')), 8000)
        );
        
        const queryPromise = supabase
          .from('signals')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(CONFIG.maxSignalsPerRun);
        
        // Гонка между запросом и таймаутом
        const result = await Promise.race([queryPromise, timeoutPromise]);
        const { data, error } = result;
        
        if (error) throw error;
        
        logger.info(`[trade-executor] ✅ Supabase вернул ${data?.length || 0} сигналов`);
        return data || [];
        
      } catch (supabaseError) {
        logger.error(`[trade-executor] ❌ Ошибка Supabase: ${supabaseError.message}`);
        
        // ===== СПОСОБ 3: ТЕСТОВЫЕ СИГНАЛЫ (ЕСЛИ ВСЁ СЛОМАЛОСЬ) =====
        logger.warn('[trade-executor] 🧪 Используем тестовые сигналы для отладки');
        
        return [
          {
            id: 999999,
            user_id: userId,
            symbol: 'BTC-USDT',
            side: 'LONG',
            entry_price: 85000,
            confidence: 'high',
            status: 'pending',
            created_at: new Date().toISOString(),
            reasons: ['Тестовый сигнал']
          }
        ];
      }
    }
    
  } catch (error) {
    logger.error(`[trade-executor] ❌ Критическая ошибка получения сигналов: ${error.message}`);
    return [];
  }
}

// ===== ФУНКЦИЯ ПРОВЕРКИ АКТИВНЫХ ПОЗИЦИЙ =====
async function getActivePositions() {
  try {
    if (!exchangeClient) {
      logger.warn('[trade-executor] ⚠️ Клиент не инициализирован');
      return { long: 0, short: 0 };
    }
    
    const positions = await exchangeClient.getPositions();
    
    let longCount = 0;
    let shortCount = 0;
    
    if (positions && Array.isArray(positions)) {
      positions.forEach(pos => {
        const size = parseFloat(pos.size || pos.quantity || 0);
        if (size > 0) {
          if (pos.side === 'LONG' || pos.positionSide === 'LONG') {
            longCount++;
          } else if (pos.side === 'SHORT' || pos.positionSide === 'SHORT') {
            shortCount++;
          }
        }
      });
    }
    
    logger.debug(`[trade-executor] 📊 Активных позиций: LONG=${longCount}, SHORT=${shortCount}`);
    return { long: longCount, short: shortCount };
    
  } catch (error) {
    logger.error(`[trade-executor] ❌ Ошибка получения позиций: ${error.message}`);
    return { long: 0, short: 0 };
  }
}

// ===== ФУНКЦИЯ ОТКРЫТИЯ СДЕЛКИ =====
async function executeTrade(signal) {
  try {
    logger.info(`[trade-executor] 🚀 Открытие сделки: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);
    
    // Проверяем клиент
    if (!exchangeClient) {
      throw new Error('Exchange клиент не инициализирован');
    }
    
    // Проверяем баланс
    const balance = await exchangeClient.getBalance();
    if (!balance || balance < 10) {
      throw new Error(`Недостаточно средств: ${balance || 0} USDT`);
    }
    
    // Рассчитываем размер позиции
    const positionSize = calculatePositionSize({
      balance: balance,
      riskPercent: CONFIG.riskPercent,
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss || signal.entry_price * 0.98,
      leverage: CONFIG.leverage
    });
    
    // Рассчитываем TP/SL
    const tpSl = calculateTPSL({
      entryPrice: signal.entry_price,
      side: signal.side,
      atr: signal.atr || 0.02,
      riskReward: 2 // 1:2 риск/прибыль
    });
    
    // Открываем позицию
    const order = await exchangeClient.placeOrder({
      symbol: signal.symbol,
      side: signal.side,
      type: 'MARKET',
      quantity: positionSize,
      leverage: CONFIG.leverage,
      stopLoss: tpSl.stopLoss || signal.stop_loss,
      takeProfit: tpSl.takeProfit || signal.take_profit,
      positionSide: signal.side.toUpperCase()
    });
    
    logger.info(`[trade-executor] ✅ Сделка открыта: ${order.orderId || 'OK'}`);
    
    // Обновляем статус сигнала в базе
    await supabase
      .from('signals')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        order_id: order.orderId || null
      })
      .eq('id', signal.id);
    
    // Отправляем уведомление в Telegram
    await notifier.sendTradeNotification({
      symbol: signal.symbol,
      side: signal.side,
      entry: signal.entry_price,
      stopLoss: tpSl.stopLoss,
      takeProfit: tpSl.takeProfit,
      size: positionSize,
      leverage: CONFIG.leverage,
      balance: balance
    });
    
    return order;
    
  } catch (error) {
    logger.error(`[trade-executor] ❌ Ошибка открытия сделки: ${error.message}`);
    
    // Обновляем статус на failed
    await supabase
      .from('signals')
      .update({
        status: 'failed',
        failed_attempts: supabase.raw('failed_attempts + 1')
      })
      .eq('id', signal.id);
    
    throw error;
  }
}

// ===== ОСНОВНОЙ ЦИКЛ =====
async function mainLoop() {
  if (isProcessing) {
    logger.debug('[trade-executor] ⏳ Предыдущий цикл ещё выполняется');
    return;
  }
  
  isProcessing = true;
  
  try {
    // Инициализируем клиент если его нет
    if (!exchangeClient) {
      logger.info('[trade-executor] 🔧 Инициализация Exchange клиента...');
      
      exchangeClient = createExchangeClient('bingx', {
        apiKey: process.env.BINGX_API_KEY || 'BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A',
        secretKey: process.env.BINGX_SECRET_KEY || 'jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA'
      });
      
      logger.info('[trade-executor] ✅ Клиент инициализирован');
    }
    
    // Получаем сигналы
    const signals = await getPendingSignals(CONFIG.userId);
    
    if (signals.length === 0) {
      logger.debug('[trade-executor] 📭 Нет ожидающих сигналов');
      return;
    }
    
    logger.info(`[trade-executor] 📨 Найдено ${signals.length} сигналов для обработки`);
    
    // Проверяем активные позиции
    const positions = await getActivePositions();
    
    // Фильтруем сигналы по типу (LONG/SHORT)
    const longSignals = signals.filter(s => s.side.toUpperCase() === 'LONG');
    const shortSignals = signals.filter(s => s.side.toUpperCase() === 'SHORT');
    
    // Обрабатываем LONG сигналы
    if (longSignals.length > 0 && positions.long < CONFIG.maxPositions) {
      const signal = longSignals[0]; // Берём первый
      try {
        await executeTrade(signal);
      } catch (error) {
        logger.error(`[trade-executor] ❌ Ошибка LONG сделки: ${error.message}`);
      }
    } else if (longSignals.length > 0 && positions.long >= CONFIG.maxPositions) {
      logger.info(`[trade-executor] ⏸️ Пропускаем LONG (уже ${positions.long} позиция)`);
    }
    
    // Обрабатываем SHORT сигналы
    if (shortSignals.length > 0 && positions.short < CONFIG.maxPositions) {
      const signal = shortSignals[0]; // Берём первый
      try {
        await executeTrade(signal);
      } catch (error) {
        logger.error(`[trade-executor] ❌ Ошибка SHORT сделки: ${error.message}`);
      }
    } else if (shortSignals.length > 0 && positions.short >= CONFIG.maxPositions) {
      logger.info(`[trade-executor] ⏸️ Пропускаем SHORT (уже ${positions.short} позиция)`);
    }
    
  } catch (error) {
    logger.error(`[trade-executor] ❌ Ошибка основного цикла: ${error.message}`);
  } finally {
    isProcessing = false;
  }
}

// ===== ЗАПУСК =====
async function start() {
  logger.info('🚀 Trade Executor Bot запущен');
  logger.info(`📋 Конфигурация:`, CONFIG);
  logger.info(`⏱️  Интервал проверки: ${CONFIG.checkInterval / 1000} секунд`);
  
  // Первый запуск сразу
  await mainLoop();
  
  // Запускаем интервал
  setInterval(mainLoop, CONFIG.checkInterval);
  
  // Обработка сигналов завершения
  process.on('SIGINT', () => {
    logger.info('🛑 Trade Executor остановлен');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    logger.info('🛑 Trade Executor остановлен');
    process.exit(0);
  });
}

// Запускаем, если файл выполняется напрямую
if (require.main === module) {
  start().catch(error => {
    logger.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, getPendingSignals, executeTrade };