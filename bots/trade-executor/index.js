// ============================================
//  МОДУЛЬ АВТОТОРГОВЛИ (TRADE EXECUTOR) — БЕЗ ОЧИСТКИ
// ============================================

const WebSocket = require('ws');
global.WebSocket = WebSocket;

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { logger } = require('../../shared/logger');
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

// ============================================
//  ПОЛУЧЕНИЕ СИГНАЛОВ (только MEDIUM и HIGH)
// ============================================

async function getPendingSignals() {
    try {
        const { data: signals, error } = await supabase
            .from('signals')
            .select('id, user_id, symbol, side, confidence, entry_price, created_at, status')
            .eq('executed', false)
            .eq('status', 'pending')
            .in('confidence', ['medium', 'high'])
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
//  МОНИТОРИНГ НОВЫХ СИГНАЛОВ
// ============================================

async function checkNewSignals() {
    log.debug('🔄 Проверка новых сигналов');

    try {
        const signals = await getPendingSignals();
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

                for (const bot of activeBots) {
                    const signalLevels = bot.risk?.signal_levels || ['medium', 'high'];
                    if (!signalLevels.includes(signal.confidence)) {
                        log.debug(`Уровень сигнала ${signal.confidence} не подходит для бота ${bot.name}`);
                        continue;
                    }

                    log.info(`📈 Исполнение сигнала ${signal.symbol} для ${user.email}`);

                    const result = await executeSignal(signal, bot, user, supabase);

                    if (result.executed) {
                        log.info(`✅ Сделка открыта для ${user.email} (${signal.symbol})`);
                        await notifier.notifyTrade(signal, result.trade);
                    } else {
                        log.warn(`⚠️ Сделка не открыта: ${result.reason}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ORDERS));
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