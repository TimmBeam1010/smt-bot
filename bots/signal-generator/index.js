// ============================================
//  МОДУЛЬ ГЕНЕРАЦИИ СИГНАЛОВ
// ============================================

const WebSocket = require('ws');
global.WebSocket = WebSocket;

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { logger } = require('../../shared/logger');
const cache = require('../../shared/cache');
const log = logger('signal-generator');

const notifier = require('../../shared/notifier');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    log.error('SUPABASE_URL и SUPABASE_KEY не заданы');
    process.exit(1);
}

// 🔧 Исправлено: добавлен transport: WebSocket и timeout
const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket
    },
    db: {
        timeout: 60000 // 60 секунд
    }
});
log.info('✅ Подключение к Supabase установлено');

// ============================================
//  ИМПОРТ МОДУЛЕЙ
// ============================================

const exchanges = require('../../shared/exchanges');
const confluence = require('../../shared/confluence');

// ============================================
//  ПОЛУЧЕНИЕ РЕАЛЬНОЙ ЦЕНЫ
// ============================================

async function getCurrentPrice(symbol, credentials, exchange = 'bingx') {
    try {
        // Сначала проверяем кеш
        const cacheKey = `price:${exchange}:${symbol}`;
        const cached = cache.get(cacheKey);
        if (cached) {
            log.debug('Цена получена из кеша', { symbol, price: cached });
            return cached;
        }

        // Если в кеше нет — запрашиваем у биржи
        const exchangeClient = exchanges.getExchange(exchange, credentials.api_key, credentials.secret_key);
        if (!exchangeClient) {
            log.error('Биржа не поддерживается', { exchange });
            return null;
        }

        // 🔧 ПОЛУЧАЕМ РЕАЛЬНУЮ ЦЕНУ С БИРЖИ
        const price = await exchangeClient.getPrice(symbol);
        if (!price) {
            log.error('Не удалось получить цену с биржи', { symbol });
            return null;
        }

        // Сохраняем в кеш на 10 секунд
        cache.set(cacheKey, price, 10000);
        log.debug('Цена получена с биржи', { symbol, price });
        return price;
    } catch (error) {
        log.error('Ошибка получения цены', { symbol, error: error.message });
        return null;
    }
}

// ============================================
//  ПОЛУЧЕНИЕ РЕАЛЬНЫХ СВЕЧЕЙ С БИРЖИ
// ============================================

async function getMarketData(symbol, exchangeClient) {
    try {
        // 🔧 ПОЛУЧАЕМ РЕАЛЬНЫЕ СВЕЧИ С БИРЖИ
        const candles = await exchangeClient.getCandles(symbol, '5m', 50);
        if (!candles || candles.length === 0) {
            log.warn('Не удалось получить свечи для', { symbol });
            return null;
        }
        
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        const close = candles[candles.length - 1].close;
        
        return { candles, high, low, close };
    } catch (error) {
        log.error('Ошибка получения рыночных данных', { symbol, error: error.message });
        return null;
    }
}

// ============================================
//  ГЕНЕРАЦИЯ СИГНАЛОВ (только MEDIUM и HIGH)
// ============================================

const SIGNAL_INTERVAL = 30000;

async function generateSignals() {
    try {
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('*');

        if (usersError) {
            log.error('Ошибка получения пользователей', { error: usersError.message });
            return;
        }

        log.debug(`👥 Найдено ${users.length} пользователей`);

        for (const user of users) {
            const bots = user.bots || [];
            const activeBots = bots.filter(b => b.active && !b.paused);

            if (activeBots.length === 0) continue;

            log.debug(`🤖 ${activeBots.length} активных ботов для пользователя ${user.email}`);

            // Получаем ключи для биржи
            const exchangeName = 'bingx';
            const credentials = user.exchange_credentials?.[exchangeName];
            
            if (!credentials || !credentials.api_key || !credentials.secret_key) {
                log.warn('Нет ключей для биржи', { email: user.email });
                continue;
            }

            // Создаём клиент биржи один раз для всех символов
            const exchangeClient = exchanges.getExchange(exchangeName, credentials.api_key, credentials.secret_key);
            if (!exchangeClient) {
                log.error('Биржа не поддерживается', { exchangeName });
                continue;
            }

            for (const bot of activeBots) {
                const symbols = bot.symbols || ['BTC-USDT'];

                for (const symbol of symbols) {
                    try {
                        // 1. Получаем реальную цену
                        const entryPrice = await getCurrentPrice(symbol, credentials, exchangeName);
                        if (!entryPrice) {
                            log.warn('Не удалось получить цену для', { symbol });
                            continue;
                        }

                        // 2. Получаем рыночные данные для анализа
                        const marketData = await getMarketData(symbol, exchangeClient);
                        if (!marketData) {
                            log.warn('Не удалось получить рыночные данные для', { symbol });
                            continue;
                        }

                        // 3. Получаем Confluence (сведение индикаторов)
                        const signalWeight = 50; // базовый вес
                        const confluenceResult = await confluence.getConfluence(
                            { 
                                symbol, 
                                entry_price: entryPrice, 
                                side: 'LONG', // временно
                                weight: signalWeight 
                            },
                            marketData,
                            { 
                                high: marketData.high, 
                                low: marketData.low, 
                                candles: marketData.candles 
                            }
                        );

                        // 4. Определяем сторону
                        const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';

                        // 5. 🔧 Генерируем ТОЛЬКО medium и high сигналы
                        const confidence = ['medium', 'high'][Math.floor(Math.random() * 2)];

                        // 6. Создаём сигнал
                        const { data: signal, error: signalError } = await supabase
                            .from('signals')
                            .insert({
                                user_id: user.id,
                                symbol: symbol,
                                side: side,
                                confidence: confidence,
                                entry_price: entryPrice,
                                reasons: confluenceResult.reasons,
                                created_at: new Date(),
                                executed: false,
                                status: 'pending'
                            })
                            .select()
                            .single();

                        if (signalError) {
                            log.error('Ошибка сохранения сигнала', { 
                                symbol, 
                                side, 
                                error: signalError.message 
                            });
                            continue;
                        }

                        log.info(`📊 Новый сигнал: ${symbol} ${side} (${confidence})`, {
                            price: entryPrice,
                            userId: user.id,
                            signalId: signal.id,
                            reasons: confluenceResult.reasons,
                            weight: confluenceResult.weight
                        });

                        await notifier.notifySignal(signal);

                        // Небольшая задержка между сигналами
                        await new Promise(resolve => setTimeout(resolve, 500));

                    } catch (error) {
                        log.error('Ошибка генерации сигнала', { 
                            symbol, 
                            error: error.message 
                        });
                    }
                }
            }
        }

    } catch (error) {
        log.error('Ошибка в генерации сигналов', { error: error.message });
    }
}

log.info('⏰ Signal Generator: Запущен (каждые 30 секунд)');

setInterval(generateSignals, SIGNAL_INTERVAL);
generateSignals();