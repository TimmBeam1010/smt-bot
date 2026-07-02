// ============================================
//  МОДУЛЬ ГЕНЕРАЦИИ СИГНАЛОВ (с логгером и кешем)
// ============================================

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Импорт логгера и кеша
const { logger } = require('../../shared/logger');
const cache = require('../../shared/cache');
const log = logger('signal-generator');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    log.error('SUPABASE_URL и SUPABASE_KEY не заданы');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
log.info('✅ Подключение к Supabase установлено');

// Импорт торговой логики
const trading = require('../../shared/trading');
const notifier = require('../../shared/notifier');

// ============================================
//  ПОЛУЧЕНИЕ ЦЕН С КЕШИРОВАНИЕМ
// ============================================

const CACHE_TTL_PRICE = 10000; // 10 секунд

async function getPriceWithCache(symbol, exchange = 'bingx') {
    const cacheKey = `price:${exchange}:${symbol}`;
    let price = cache.get(cacheKey);
    
    if (price) {
        log.debug('Цена получена из кеша', { symbol, price });
        return price;
    }

    try {
        // Здесь должен быть реальный запрос к бирже
        // Пока используем заглушку
        price = 60000 + Math.random() * 1000;
        cache.set(cacheKey, price, CACHE_TTL_PRICE);
        log.debug('Цена получена с биржи', { symbol, price });
        return price;
    } catch (error) {
        log.error('Ошибка получения цены', { symbol, error: error.message });
        return null;
    }
}

// ============================================
//  ГЕНЕРАЦИЯ СИГНАЛОВ
// ============================================

const SIGNAL_INTERVAL = 30000; // 30 секунд

async function generateSignals() {
    try {
        // Получаем всех пользователей с активными ботами
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

            for (const bot of activeBots) {
                const symbols = bot.symbols || ['BTC-USDT'];

                for (const symbol of symbols) {
                    try {
                        // Получаем цену с кешированием
                        const price = await getPriceWithCache(symbol);
                        if (!price) continue;

                        // Генерируем сигнал (заглушка)
                        const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';
                        const confidence = ['low', 'medium', 'high'][Math.floor(Math.random() * 3)];
                        const entryPrice = price;

                        // Сохраняем сигнал в БД
                        const { data: signal, error: signalError } = await supabase
                            .from('signals')
                            .insert({
                                user_id: user.id,
                                symbol: symbol,
                                side: side,
                                confidence: confidence,
                                entry_price: entryPrice,
                                created_at: new Date(),
                                executed: false
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
                            signalId: signal.id
                        });

                        // Уведомление о новом сигнале
                        await notifier.notifySignal(signal);

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

// ============================================
//  ЗАПУСК
// ============================================

log.info('⏰ Signal Generator: Запущен (каждые 30 секунд)');

setInterval(generateSignals, SIGNAL_INTERVAL);

// Первый запуск сразу
generateSignals();