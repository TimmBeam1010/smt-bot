// ============================================
//  МОДУЛЬ АВТОТОРГОВЛИ (TRADE EXECUTOR)
// ============================================

const WebSocket = require('ws');
global.WebSocket = WebSocket;

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { logger } = require('../../shared/logger');
const cache = require('../../shared/cache');
const log = logger('trade-executor');

const notifier = require('../../shared/notifier');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    log.error('SUPABASE_URL и SUPABASE_KEY не заданы');
    process.exit(1);
}

// 🔧 Увеличен таймаут до 120 секунд
const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket
    },
    db: {
        timeout: 120000, // 120 секунд
        schema: 'public'
    }
});
log.info('✅ Подключение к Supabase установлено');

const { executeSignal } = require('../../shared/executor');

// ============================================
//  КОНФИГУРАЦИЯ
// ============================================

const MAX_SIGNALS_PER_BATCH = 5;
const DELAY_BETWEEN_ORDERS = 2000;
const CHECK_INTERVAL = 30000;
const SIGNAL_TTL = {
    low: 6 * 60 * 60 * 1000,
    medium: 12 * 60 * 60 * 1000,
    high: 24 * 60 * 60 * 1000
};

let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// ============================================
//  ОЧИСТКА УСТАРЕВШИХ СИГНАЛОВ (оптимизирована)
// ============================================

async function cleanupExpiredSignals() {
    try {
        const now = new Date();
        const expiredSignals = [];

        // 🔧 Оптимизированный запрос: только ID и confidence
        const { data: signals, error } = await supabase
            .from('signals')
            .select('id, confidence, created_at')
            .eq('executed', false)
            .eq('status', 'pending');

        if (error) {
            log.error('Ошибка получения сигналов для очистки', { error: error.message });
            return;
        }

        if (!signals || signals.length === 0) return;

        for (const signal of signals) {
            const createdAt = new Date(signal.created_at);
            const age = now - createdAt;
            const ttl = SIGNAL_TTL[signal.confidence] || SIGNAL_TTL.medium;

            if (age > ttl) {
                expiredSignals.push(signal.id);
            }
        }

        if (expiredSignals.length > 0) {
            // 🔧 Удаляем пачками по 100
            const batchSize = 100;
            for (let i = 0; i < expiredSignals.length; i += batchSize) {
                const batch = expiredSignals.slice(i, i + batchSize);
                const { error: updateError } = await supabase
                    .from('signals')
                    .update({
                        status: 'expired',
                        executed: true
                    })
                    .in('id', batch);

                if (updateError) {
                    log.error('Ошибка обновления устаревших сигналов', { error: updateError.message });
                } else {
                    log.info(`🧹 Очищено ${batch.length} устаревших сигналов (TTL истёк)`);
                }
            }
        }
    } catch (error) {
        log.error('Ошибка в cleanupExpiredSignals', { error: error.message });
    }
}

// ============================================
//  ПОЛУЧЕНИЕ СИГНАЛОВ (оптимизировано)
// ============================================

async function getPendingSignals() {
    try {
        // 🔧 Оптимизированный запрос: только нужные поля
        const { data: signals, error } = await supabase
            .from('signals')
            .select('id, user_id, symbol, side, confidence, entry_price, created_at, status')
            .eq('executed', false)
            .or('status.eq.pending,status.is.null')
            .order('created_at', { ascending: true })
            .limit(MAX_SIGNALS_PER_BATCH);

        if (error) {
            log.error('Ошибка получения сигналов', { error: error.message });
            return null;
        }

        return signals;
    } catch (error) {
        log.error('Ошибка в getPendingSignals', { error: error.message });
        return null;
    }
}

// ============================================
//  МОНИТОРИНГ НОВЫХ И PENDING СИГНАЛОВ
// ============================================

async function checkNewSignals() {
    log.debug('🔄 Проверка новых сигналов');

    try {
        // 1. Очищаем устаревшие
        await cleanupExpiredSignals();

        // 2. Получаем сигналы
        const signals = await getPendingSignals();
        if (!signals || signals.length === 0) {
            consecutiveErrors = 0;
            return;
        }

        log.info(`📡 Найдено ${signals.length} сигналов в очереди`);

        // 3. Обрабатываем сигналы
        for (const signal of signals) {
            // 🔍 Логирование user_id для отладки
            log.info(`🔍 Обработка сигнала ID: ${signal.id}, user_id: ${signal.user_id}`);

            try {
                // Получаем пользователя
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', signal.user_id)
                    .single();

                if (userError || !user) {
                    log.error('Пользователь не найден', { userId: signal.user_id, signalId: signal.id });
                    consecutiveErrors++;
                    continue;
                }

                // Проверяем активные боты
                const bots = user.bots || [];
                const activeBots = bots.filter(bot =>
                    bot.active &&
                    !bot.paused &&
                    (bot.mode === 'auto_trade' || bot.mode === 'hybrid')
                );

                if (activeBots.length === 0) {
                    log.warn('Нет активных ботов', { email: user.email });
                    continue;
                }

                // Исполняем сигнал для каждого бота
                for (const bot of activeBots) {
                    const signalLevels = bot.risk?.signal_levels || ['low', 'medium', 'high'];
                    if (!signalLevels.includes(signal.confidence)) {
                        log.debug(`Уровень сигнала ${signal.confidence} не подходит для бота ${bot.name}`);
                        continue;
                    }

                    log.info(`📈 Исполнение сигнала ${signal.symbol} для ${user.email}`);

                    const result = await executeSignal(signal, bot, user, supabase);

                    if (result.executed) {
                        log.info(`✅ Сделка открыта для ${user.email} (${signal.symbol})`);
                        await notifier.notifyTrade(signal, result.trade);
                        consecutiveErrors = 0;
                    } else {
                        log.warn(`⚠️ Сделка не открыта: ${result.reason}`);
                        consecutiveErrors++;
                    }

                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ORDERS));
                }

            } catch (err) {
                log.error('Ошибка обработки сигнала', {
                    signalId: signal.id,
                    error: err.message
                });
                consecutiveErrors++;
            }
        }

        // Если ошибок слишком много — делаем паузу
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            log.warn(`⚠️ Слишком много ошибок подряд (${consecutiveErrors}). Пауза 60 секунд...`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            consecutiveErrors = 0;
        }

    } catch (err) {
        log.error('Ошибка в мониторинге', { error: err.message });
        consecutiveErrors++;
    }
}

// ============================================
//  ЗАПУСК
// ============================================

log.info('⏰ Trade Executor: Запущен (мониторинг каждые 30 секунд)');

setInterval(checkNewSignals, CHECK_INTERVAL);
checkNewSignals();