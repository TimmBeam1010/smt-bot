// ============================================
//  МОДУЛЬ АВТОТОРГОВЛИ (TRADE EXECUTOR)
//  с механизмом скипа зависших сигналов
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

const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: { transport: WebSocket },
    db: { timeout: 60000, schema: 'public' }
});
log.info('✅ Подключение к Supabase установлено');

const { executeSignal } = require('../../shared/executor');

// ============================================
//  КОНФИГУРАЦИЯ
// ============================================

const MAX_SIGNALS_PER_BATCH = 5;
const DELAY_BETWEEN_ORDERS = 2000;
const CHECK_INTERVAL = 30000;
const MAX_FAILED_ATTEMPTS = 5; // ⚠️ НОВОЕ: максимальное число неудачных попыток
const SIGNAL_TTL_MINUTES = 30; // ⚠️ НОВОЕ: максимальное время жизни сигнала (в минутах)

const SIGNAL_TTL = {
    low: 6 * 60 * 60 * 1000,
    medium: 12 * 60 * 60 * 1000,
    high: 24 * 60 * 60 * 1000
};

// ============================================
//  ОЧИСТКА УСТАРЕВШИХ СИГНАЛОВ
// ============================================

async function cleanupExpiredSignals() {
    try {
        const now = new Date();
        const expiredSignals = [];

        // Получаем все неисполненные сигналы
        const { data: signals, error } = await supabase
            .from('signals')
            .select('id, confidence, created_at, failed_attempts')
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
            const failedAttempts = signal.failed_attempts || 0;

            // Удаляем, если:
            // 1. Истёк TTL
            // 2. Превышен лимит попыток
            // 3. Сигнал висит более SIGNAL_TTL_MINUTES
            if (age > ttl || 
                failedAttempts >= MAX_FAILED_ATTEMPTS || 
                age > SIGNAL_TTL_MINUTES * 60 * 1000) {
                expiredSignals.push(signal.id);
            }
        }

        if (expiredSignals.length > 0) {
            const { error: updateError } = await supabase
                .from('signals')
                .update({
                    status: 'expired',
                    executed: true
                })
                .in('id', expiredSignals);

            if (updateError) {
                log.error('Ошибка обновления устаревших сигналов', { error: updateError.message });
            } else {
                log.info(`🧹 Очищено ${expiredSignals.length} устаревших сигналов`);
            }
        }
    } catch (error) {
        log.error('Ошибка в cleanupExpiredSignals', { error: error.message });
    }
}

// ============================================
//  ОБРАБОТКА СИГНАЛА С УЧЁТОМ ОШИБОК
// ============================================

async function processSignal(signal, user, bot) {
    try {
        log.info(`📈 Исполнение сигнала ${signal.symbol} для ${user.email}`);

        const result = await executeSignal(signal, bot, user, supabase);

        if (result.executed) {
            log.info(`✅ Сделка открыта для ${user.email} (${signal.symbol})`);
            await notifier.notifyTrade(signal, result.trade);
            return { success: true };
        } else {
            log.warn(`⚠️ Сделка не открыта: ${result.reason}`);

            // Увеличиваем счётчик неудачных попыток
            await supabase
                .from('signals')
                .update({ 
                    failed_attempts: supabase.raw('failed_attempts + 1')
                })
                .eq('id', signal.id);

            return { success: false, reason: result.reason };
        }
    } catch (error) {
        log.error('Ошибка исполнения сигнала', { error: error.message });
        await supabase
            .from('signals')
            .update({ 
                failed_attempts: supabase.raw('failed_attempts + 1')
            })
            .eq('id', signal.id);
        return { success: false, reason: error.message };
    }
}

// ============================================
//  МОНИТОРИНГ НОВЫХ И PENDING СИГНАЛОВ
// ============================================

async function checkNewSignals() {
    log.debug('🔄 Проверка новых сигналов');

    try {
        await cleanupExpiredSignals();

        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('executed', false)
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(MAX_SIGNALS_PER_BATCH);

        if (error) {
            log.error('Ошибка получения сигналов', { error: error.message });
            return;
        }

        if (!signals || signals.length === 0) {
            return;
        }

        log.info(`📡 Найдено ${signals.length} сигналов в очереди`);

        for (const signal of signals) {
            try {
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', signal.user_id)
                    .single();

                if (userError || !user) {
                    log.error('Пользователь не найден', { userId: signal.user_id });
                    await supabase
                        .from('signals')
                        .update({ status: 'expired', executed: true })
                        .eq('id', signal.id);
                    continue;
                }

                const bots = user.bots || [];
                const activeBots = bots.filter(bot =>
                    bot.active &&
                    !bot.paused &&
                    (bot.mode === 'auto_trade' || bot.mode === 'hybrid')
                );

                if (activeBots.length === 0) {
                    log.warn('Нет активных ботов', { email: user.email });
                    await supabase
                        .from('signals')
                        .update({ status: 'expired', executed: true })
                        .eq('id', signal.id);
                    continue;
                }

                let executed = false;
                for (const bot of activeBots) {
                    const signalLevels = bot.risk?.signal_levels || ['low', 'medium', 'high'];
                    if (!signalLevels.includes(signal.confidence)) {
                        log.debug(`Уровень сигнала ${signal.confidence} не подходит для бота ${bot.name}`);
                        continue;
                    }

                    const result = await processSignal(signal, user, bot);
                    if (result.success) {
                        executed = true;
                        break;
                    }

                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ORDERS));
                }

                if (!executed) {
                    log.warn(`⚠️ Сигнал ${signal.id} не исполнен ни одним ботом`);
                }

            } catch (error) {
                log.error('Ошибка обработки сигнала', { error: error.message });
            }
        }

    } catch (error) {
        log.error('Ошибка в мониторинге', { error: error.message });
    }
}

log.info('⏰ Trade Executor: Запущен (мониторинг каждые 30 секунд)');

setInterval(checkNewSignals, CHECK_INTERVAL);
checkNewSignals();