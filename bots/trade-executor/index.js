// ============================================
//  МОДУЛЬ АВТОТОРГОВЛИ (TRADE EXECUTOR) - с логгером и кешем
// ============================================

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Импорт логгера и кеша
const { logger } = require('../../shared/logger');
const cache = require('../../shared/cache');
const log = logger('trade-executor');

const notifier = require('../../shared/notifier');

// === ИСПРАВЛЕНИЕ ДЛЯ WEBSOCKET (Node.js 20) ===
const WebSocket = require('ws');
global.WebSocket = WebSocket;
// =============================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    log.error('SUPABASE_URL и SUPABASE_KEY не заданы');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
log.info('✅ Подключение к Supabase установлено');

// ============================================
//  ИМПОРТ ОБЩЕЙ ЛОГИКИ
// ============================================

const { executeSignal } = require('../../shared/executor');

// ============================================
//  МОНИТОРИНГ НОВЫХ СИГНАЛОВ
// ============================================

const MAX_SIGNALS_PER_BATCH = 1;
const DELAY_BETWEEN_ORDERS = 2000;
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

async function checkNewSignals() {
    log.debug('🔄 Проверка новых сигналов');

    try {
        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('executed', false)
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

        log.info(`📡 Найдено ${signals.length} новых сигналов`);

        for (const signal of signals) {
            try {
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', signal.user_id)
                    .single();

                if (userError || !user) {
                    log.error('Пользователь не найден', { userId: signal.user_id, signalId: signal.id });
                    await notifier.notifyError(`Пользователь ${signal.user_id} не найден`, `Сигнал ${signal.id}`);
                    consecutiveErrors++;
                    continue;
                }

                log.debug(`👤 Пользователь: ${user.email}, Ботов: ${user.bots?.length || 0}`);

                const bots = user.bots || [];
                const activeBots = bots.filter(bot => 
                    bot.active && 
                    !bot.paused && 
                    (bot.mode === 'auto_trade' || bot.mode === 'hybrid')
                );

                log.debug(`🤖 Активных ботов в режиме auto_trade/hybrid: ${activeBots.length}`);

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
                        log.info(`✅ Сделка открыта для ${user.email} (${signal.symbol})`, { 
                            symbol: signal.symbol,
                            side: signal.side,
                            tradeId: result.trade?.id
                        });
                        await notifier.notifyTrade(signal, result.trade);
                        consecutiveErrors = 0;
                    } else {
                        log.warn(`⚠️ Сделка не открыта: ${result.reason}`);
                        await notifier.notifyError(
                            `Сделка не открыта: ${result.reason}`,
                            `${signal.symbol} | ${signal.side} | Пользователь: ${user.email}`
                        );
                        consecutiveErrors++;
                    }

                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ORDERS));
                }

            } catch (err) {
                log.error('Ошибка обработки сигнала', { 
                    signalId: signal.id, 
                    error: err.message 
                });
                await notifier.notifyError(
                    `Ошибка обработки сигнала ${signal.id}: ${err.message}`,
                    `Сигнал: ${signal.symbol} | ${signal.side}`
                );
                consecutiveErrors++;
            }
        }

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            log.warn(`⚠️ Слишком много ошибок подряд (${consecutiveErrors}). Пауза 60 секунд...`);
            await notifier.notifyError(
                `Слишком много ошибок (${consecutiveErrors}). Бот делает паузу на 60 секунд.`,
                'Trade Executor'
            );
            await new Promise(resolve => setTimeout(resolve, 60000));
            consecutiveErrors = 0;
        }

    } catch (err) {
        log.error('Ошибка в мониторинге', { error: err.message });
        await notifier.notifyError(`Ошибка в мониторинге: ${err.message}`, 'Trade Executor');
        consecutiveErrors++;
    }
}

// ============================================
//  ЗАПУСК
// ============================================

log.info('⏰ Trade Executor: Запущен (мониторинг каждые 30 секунд)');

setInterval(checkNewSignals, 30000);

// Первый запуск сразу
checkNewSignals();