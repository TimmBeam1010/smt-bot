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

// 🔧 Исправлено: добавлен transport: WebSocket и timeout
const supabase = createClient(supabaseUrl, supabaseKey, {
    realtime: {
        transport: WebSocket
    },
    db: {
        timeout: 60000
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
//  ОЧИСТКА УСТАРЕВШИХ СИГНАЛОВ
// ============================================

async function cleanupExpiredSignals() {
    try {
        const now = new Date();
        const expiredSignals = [];

        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('executed', false)
            .eq('status', 'pending');

        if (error) {
            log.error('Ошибка получения сигналов для очистки', { error: error.message });
            return;
        }

        for (const signal of signals) {
            const createdAt = new Date(signal.created_at);
            const age = now - createdAt;
            const ttl = SIGNAL_TTL[signal.confidence] || SIGNAL_TTL.medium;

            if (age > ttl) {
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
                log.info(`🧹 Очищено ${expiredSignals.length} устаревших сигналов (TTL истёк)`);
            }
        }
    } catch (error) {
        log.error('Ошибка в cleanupExpiredSignals', { error: error.message });
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
            await notifier.notifyError(`Ошибка получения сигналов: ${error.message}`, 'Supabase');
            consecutiveErrors++;
            return;
        }

        if (signals.length === 0) {
            consecutiveErrors = 0;
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
                    log.error('Пользователь не найден', { userId: signal.user_id, signalId: signal.id });
                    consecutiveErrors++;
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
                    continue;
                }

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

log.info('⏰ Trade Executor: Запущен (мониторинг каждые 30 секунд)');

setInterval(checkNewSignals, CHECK_INTERVAL);
checkNewSignals();