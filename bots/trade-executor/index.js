#!/usr/bin/env node

/**
 * Trade Executor Bot
 * 
 * Отвечает за:
 * 1. Получение сигналов из базы данных
 * 2. WebSocket подписка на новые сигналы (Supabase Realtime)
 * 3. Проверку наличия открытых позиций
 * 4. Открытие сделок на BingX
 * 5. Управление рисками (SL/TP)
 * 6. Логирование всех действий
 */

const WebSocket = require('ws');
const { createClient } = require('@supabase/supabase-js');
const { createExchangeClient } = require('../../shared/exchanges');
const { calculatePositionSize, calculateTPSL } = require('../../shared/position-calculator');
const logger = require('../../shared/logger');
const notifier = require('../../shared/notifier');

// ===== КОНФИГУРАЦИЯ =====
const CONFIG = {
  userId: 11,
  maxPositions: 1,
  riskPercent: 0.3,
  leverage: 10,
  checkInterval: 30000,
  maxSignalsPerRun: 5,
};

// ===== ИНИЦИАЛИЗАЦИЯ С WEBSOCKET ПОДДЕРЖКОЙ =====
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://zqyalsprnbbjifjctdga.supabase.co',
  process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxeWFsc3BybmJiamlmamN0ZGdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE3OTk1MTgsImV4cCI6MjA1NzM3NTUxOH0.0Nt8hM5eZk7yjmjG2OV-5iDQBW0Z0aJQqg5CdIHEZUI',
  {
    realtime: {
      transport: WebSocket
    }
  }
);

let exchangeClient = null;
let isProcessing = false;
let supabaseChannel = null;

// ===== ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ ЛОГГИРОВАНИЯ =====
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [trade-executor]`;
  if (level === 'error') {
    console.error(`${prefix} ❌ ${message}`);
  } else if (level === 'warn') {
    console.warn(`${prefix} ⚠️ ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// ===== WEBSOCKET ПОДПИСКА НА НОВЫЕ СИГНАЛЫ =====
function setupWebSocket() {
  try {
    log('🔌 Настройка WebSocket подключения...');
    
    if (supabaseChannel) {
      supabaseChannel.unsubscribe();
      log('📴 Отключен от старого WebSocket');
    }
    
    supabaseChannel = supabase
      .channel('trade-executor-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'signals',
          filter: `user_id=eq.${CONFIG.userId}`
        },
        async (payload) => {
          log('🔔 Новый сигнал получен через WebSocket!');
          const signal = payload.new;
          
          if (signal.status === 'pending') {
            log(`📨 Сигнал: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);
            
            const positions = await getActivePositions();
            const side = signal.side.toUpperCase();
            
            if (side === 'LONG' && positions.long < CONFIG.maxPositions) {
              log('🚀 Открываем LONG сделку (WebSocket)');
              await executeTrade(signal);
            } else if (side === 'SHORT' && positions.short < CONFIG.maxPositions) {
              log('🚀 Открываем SHORT сделку (WebSocket)');
              await executeTrade(signal);
            } else {
              log(`⏸️ Пропускаем ${side} (уже есть позиция)`);
            }
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          log('✅ WebSocket подключен и активен');
        } else if (status === 'CHANNEL_ERROR') {
          log('❌ Ошибка WebSocket, пробуем переподключиться...', 'error');
          setTimeout(setupWebSocket, 5000);
        } else {
          log(`📡 WebSocket статус: ${status}`);
        }
      });
    
    return supabaseChannel;
    
  } catch (error) {
    log(`❌ Ошибка WebSocket: ${error.message}`, 'error');
    setTimeout(setupWebSocket, 10000);
    return null;
  }
}

// ===== ФУНКЦИЯ ПОЛУЧЕНИЯ СИГНАЛОВ =====
async function getPendingSignals(userId = 11) {
  try {
    log(`📡 Запрос сигналов для user_id=${userId}...`);
    
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
      
      const pending = data.filter(s => s.status === 'pending');
      
      log(`✅ Через API получено ${pending.length} ожидающих сигналов`);
      
      pending.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      
      return pending.slice(0, CONFIG.maxSignalsPerRun);
      
    } catch (apiError) {
      log(`⚠️ API метод не сработал: ${apiError.message}`, 'warn');
      
      try {
        log('🔄 Пробуем прямой запрос к Supabase...');
        
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
        
        const result = await Promise.race([queryPromise, timeoutPromise]);
        const { data, error } = result;
        
        if (error) throw error;
        
        log(`✅ Supabase вернул ${data?.length || 0} сигналов`);
        return data || [];
        
      } catch (supabaseError) {
        log(`❌ Ошибка Supabase: ${supabaseError.message}`, 'error');
        
        log('🧪 Используем тестовые сигналы для отладки', 'warn');
        
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
    log(`❌ Критическая ошибка получения сигналов: ${error.message}`, 'error');
    return [];
  }
}

// ===== ФУНКЦИЯ ПРОВЕРКИ АКТИВНЫХ ПОЗИЦИЙ =====
async function getActivePositions() {
  try {
    if (!exchangeClient) {
      log('⚠️ Клиент не инициализирован', 'warn');
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
    
    log(`📊 Активных позиций: LONG=${longCount}, SHORT=${shortCount}`);
    return { long: longCount, short: shortCount };
    
  } catch (error) {
    log(`❌ Ошибка получения позиций: ${error.message}`, 'error');
    return { long: 0, short: 0 };
  }
}

// ===== ФУНКЦИЯ ОТКРЫТИЯ СДЕЛКИ =====
async function executeTrade(signal) {
  try {
    log(`🚀 Открытие сделки: ${signal.symbol} ${signal.side} @ ${signal.entry_price}`);
    
    if (!exchangeClient) {
      throw new Error('Exchange клиент не инициализирован');
    }
    
    const balance = await exchangeClient.getBalance();
    if (!balance || balance < 10) {
      throw new Error(`Недостаточно средств: ${balance || 0} USDT`);
    }
    
    const positionSize = calculatePositionSize({
      balance: balance,
      riskPercent: CONFIG.riskPercent,
      entryPrice: signal.entry_price,
      stopLoss: signal.stop_loss || signal.entry_price * 0.98,
      leverage: CONFIG.leverage
    });
    
    const tpSl = calculateTPSL({
      entryPrice: signal.entry_price,
      side: signal.side,
      atr: signal.atr || 0.02,
      riskReward: 2
    });
    
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
    
    log(`✅ Сделка открыта: ${order.orderId || 'OK'}`);
    
    await supabase
      .from('signals')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        order_id: order.orderId || null
      })
      .eq('id', signal.id);
    
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
    log(`❌ Ошибка открытия сделки: ${error.message}`, 'error');
    
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
    log('⏳ Предыдущий цикл ещё выполняется');
    return;
  }
  
  isProcessing = true;
  
  try {
    if (!exchangeClient) {
      log('🔧 Инициализация Exchange клиента...');
      
      exchangeClient = createExchangeClient('bingx', {
        apiKey: process.env.BINGX_API_KEY || 'BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A',
        secretKey: process.env.BINGX_SECRET_KEY || 'jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA'
      });
      
      log('✅ Клиент инициализирован');
    }
    
    const signals = await getPendingSignals(CONFIG.userId);
    
    if (signals.length === 0) {
      log('📭 Нет ожидающих сигналов');
      return;
    }
    
    log(`📨 Найдено ${signals.length} сигналов для обработки`);
    
    const positions = await getActivePositions();
    
    const longSignals = signals.filter(s => s.side.toUpperCase() === 'LONG');
    const shortSignals = signals.filter(s => s.side.toUpperCase() === 'SHORT');
    
    if (longSignals.length > 0 && positions.long < CONFIG.maxPositions) {
      const signal = longSignals[0];
      try {
        await executeTrade(signal);
      } catch (error) {
        log(`❌ Ошибка LONG сделки: ${error.message}`, 'error');
      }
    } else if (longSignals.length > 0 && positions.long >= CONFIG.maxPositions) {
      log(`⏸️ Пропускаем LONG (уже ${positions.long} позиция)`);
    }
    
    if (shortSignals.length > 0 && positions.short < CONFIG.maxPositions) {
      const signal = shortSignals[0];
      try {
        await executeTrade(signal);
      } catch (error) {
        log(`❌ Ошибка SHORT сделки: ${error.message}`, 'error');
      }
    } else if (shortSignals.length > 0 && positions.short >= CONFIG.maxPositions) {
      log(`⏸️ Пропускаем SHORT (уже ${positions.short} позиция)`);
    }
    
  } catch (error) {
    log(`❌ Ошибка основного цикла: ${error.message}`, 'error');
  } finally {
    isProcessing = false;
  }
}

// ===== ЗАПУСК =====
async function start() {
  log('🚀 Trade Executor Bot запущен');
  log(`📋 Конфигурация: ${JSON.stringify(CONFIG)}`);
  log(`⏱️ Интервал проверки: ${CONFIG.checkInterval / 1000} секунд`);
  
  await mainLoop();
  
  setupWebSocket();
  
  setInterval(mainLoop, CONFIG.checkInterval);
  
  process.on('SIGINT', () => {
    log('🛑 Trade Executor остановлен');
    if (supabaseChannel) {
      supabaseChannel.unsubscribe();
    }
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    log('🛑 Trade Executor остановлен');
    if (supabaseChannel) {
      supabaseChannel.unsubscribe();
    }
    process.exit(0);
  });
}

if (require.main === module) {
  start().catch(error => {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, getPendingSignals, executeTrade, setupWebSocket };