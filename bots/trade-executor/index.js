// ============================================
//  МОДУЛЬ АВТОТОРГОВЛИ (TRADE EXECUTOR)
//  Версия: 2.0 - с умным управлением позициями
// ============================================

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

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
const exchanges = require('../../shared/exchanges');

// ============================================
//  КОНФИГУРАЦИЯ
// ============================================

const MAX_SIGNALS_PER_BATCH = 10;
const DELAY_BETWEEN_ORDERS = 2000;
const CHECK_INTERVAL = 30000; // 30 секунд
const SCORE_THRESHOLD = 10; // Порог для сравнения весов

// Время жизни сигналов (TTL) в зависимости от уровня уверенности
const SIGNAL_TTL = {
    low: 6 * 60 * 60 * 1000,      // 6 часов
    medium: 12 * 60 * 60 * 1000,  // 12 часов
    high: 24 * 60 * 60 * 1000     // 24 часа
};

let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 5;

// ============================================
//  ОЦЕНКА КАЧЕСТВА СИГНАЛА
// ============================================

function calculateSignalScore(signal) {
    let score = 0;

    // 1. Уровень уверенности (макс 40)
    const confidenceMap = {
        high: 40,
        medium: 25,
        low: 10
    };
    score += confidenceMap[signal.confidence] || 10;

    // 2. Количество подтверждений (макс 20)
    const reasonsCount = signal.reasons?.length || 0;
    score += Math.min(20, reasonsCount * 4);

    // 3. Соотношение риск/прибыль (макс 20)
    if (signal.entry_price && signal.stop_loss && signal.take_profit) {
        const risk = Math.abs(signal.entry_price - signal.stop_loss);
        const reward = Math.abs(signal.take_profit - signal.entry_price);
        if (risk > 0 && reward > 0) {
            const ratio = reward / risk;
            score += Math.min(20, ratio * 6);
        }
    }

    // 4. Временная близость (макс 10)
    const ageMs = Date.now() - new Date(signal.created_at).getTime();
    const ageMinutes = ageMs / (60 * 1000);
    const timeWeight = Math.max(0, 10 - ageMinutes * 0.2);
    score += timeWeight;

    return Math.round(score);
}

// ============================================
//  ОЦЕНКА КАЧЕСТВА ПОЗИЦИИ
// ============================================

function calculatePositionScore(position) {
    let score = 0;

    // 1. Прибыльность (макс 40)
    const pnlPercent = position.unrealizedProfit || 0;
    if (pnlPercent > 0) {
        score += Math.min(40, pnlPercent * 2);
    } else if (pnlPercent < 0) {
        score += Math.max(-20, pnlPercent);
    }

    // 2. Время жизни (макс 30) - чем свежее, тем выше
    // если позиция открыта недавно - выше вес
    // можно доработать

    // 3. Стабильность (макс 30)
    // если позиция в прибыли и держится - выше вес
    // можно доработать

    return Math.round(score);
}

// ============================================
//  СРАВНЕНИЕ СИГНАЛА И ПОЗИЦИИ
// ============================================

function compareSignalWithPosition(signal, position) {
    const signalScore = calculateSignalScore(signal);
    const positionScore = calculatePositionScore(position);

    const diff = signalScore - positionScore;

    if (diff > SCORE_THRESHOLD) {
        return 'better'; // Сигнал лучше позиции
    } else if (diff >= -SCORE_THRESHOLD && diff <= SCORE_THRESHOLD) {
        return 'equal'; // Равный вес
    } else {
        return 'worse'; // Сигнал хуже позиции
    }
}

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
//  ОТБОР ЛУЧШЕГО СИГНАЛА ПО МОНЕТЕ
// ============================================

function getBestSignalForSymbol(signals, currentPrice) {
    if (!signals || signals.length === 0) return null;
    if (signals.length === 1) return signals[0];

    const scoredSignals = signals.map(signal => ({
        signal,
        weight: calculateSignalScore(signal)
    }));

    scoredSignals.sort((a, b) => b.weight - a.weight);
    return scoredSignals[0].signal;
}

// ============================================
//  УПРАВЛЕНИЕ ПОЗИЦИЕЙ
// ============================================

async function handleOppositeSignal(signal, position, bot, user, exchangeClient) {
    const comparison = compareSignalWithPosition(signal, position);

    switch (comparison) {
        case 'better': {
            // 1. Закрываем текущую позицию
            try {
                await exchangeClient.closePosition(signal.symbol, position.positionSide);
                log.info(`✅ Закрыта позиция ${position.positionSide} по ${signal.symbol}`);

                await supabase
                    .from('trades')
                    .update({ status: 'closed', closed_at: new Date().toISOString() })
                    .eq('symbol', signal.symbol)
                    .eq('status', 'open');

                // 2. Открываем новую позицию
                const result = await executeSignal(signal, bot, user, supabase);
                if (result.executed) {
                    log.info(`✅ Открыта новая позиция ${signal.side} по ${signal.symbol} (сигнал лучше)`);
                    await notifier.notifyInfo(`🔄 Переворот позиции: ${position.positionSide} → ${signal.side} по ${signal.symbol}`);
                }

                // 3. Помечаем сигнал как исполненный
                await supabase
                    .from('signals')
                    .update({ executed: true })
                    .eq('id', signal.id);

            } catch (error) {
                log.error('❌ Ошибка при перевороте позиции', { error: error.message });
                await notifier.notifyError(`Ошибка переворота позиции: ${error.message}`, signal.symbol);
            }
            break;
        }

        case 'equal': {
            // 1. Оставляем текущую позицию
            // 2. Открываем новую в противоположном направлении (хедж)
            try {
                const result = await executeSignal(signal, bot, user, supabase);
                if (result.executed) {
                    log.info(`✅ Открыта противоположная позиция ${signal.side} по ${signal.symbol} (равный вес)`);
                    await notifier.notifyInfo(`🔄 Открыт хедж: ${signal.side} по ${signal.symbol}`);
                }

                // 3. Помечаем сигнал как исполненный
                await supabase
                    .from('signals')
                    .update({ executed: true })
                    .eq('id', signal.id);

            } catch (error) {
                log.error('❌ Ошибка открытия хеджа', { error: error.message });
                await notifier.notifyError(`Ошибка открытия хеджа: ${error.message}`, signal.symbol);
            }
            break;
        }

        case 'worse': {
            // 1. Оставляем текущую позицию
            // 2. Сигнал остаётся в очереди (будет перепроверяться)
            log.debug(`⏭️ Сигнал ${signal.id} хуже позиции по ${signal.symbol}, остаётся в очереди`);
            break;
        }
    }
}

async function handleSameDirectionSignal(signal, position, bot, user, exchangeClient) {
    const comparison = compareSignalWithPosition(signal, position);

    if (comparison === 'better' || comparison === 'equal') {
        // 1. Обновляем TP/SL на бирже
        try {
            log.info(`📊 Обновление TP/SL для ${signal.symbol} (сигнал ${comparison})`);

            // Обновляем TP/SL через API биржи
            // Зависит от реализации exchangeClient
            // Например:
            // await exchangeClient.updatePosition(signal.symbol, position.positionSide, position.quantity, signal.entry_price, signal.take_profit, signal.stop_loss);

            // 2. Обновляем запись в БД
            const { error } = await supabase
                .from('trades')
                .update({
                    stop_loss: signal.stop_loss,
                    take_profit: signal.take_profit
                })
                .eq('symbol', signal.symbol)
                .eq('status', 'open');

            if (error) {
                log.error('❌ Ошибка обновления TP/SL в БД', { error: error.message });
            } else {
                log.info(`✅ TP/SL обновлены для ${signal.symbol}: SL=${signal.stop_loss}, TP=${signal.take_profit}`);
                await notifier.notifyInfo(`✅ TP/SL обновлены для ${signal.symbol}`);
            }

            // 3. Помечаем сигнал как исполненный
            await supabase
                .from('signals')
                .update({ executed: true })
                .eq('id', signal.id);

        } catch (error) {
            log.error('❌ Ошибка обновления TP/SL', { error: error.message });
            await notifier.notifyError(`Ошибка обновления TP/SL: ${error.message}`, signal.symbol);
        }
    } else {
        // Сигнал хуже — удаляем
        await supabase
            .from('signals')
            .update({ status: 'ignored', executed: true })
            .eq('id', signal.id);
        log.debug(`⏭️ Сигнал ${signal.id} хуже позиции по ${signal.symbol}, удалён`);
    }
}

// ============================================
//  ИСПОЛНЕНИЕ СИГНАЛА С УПРАВЛЕНИЕМ ПОЗИЦИЕЙ
// ============================================

async function executeSignalWithManagement(signal, bot, user) {
    try {
        // 1. Получаем клиент биржи
        const exchangeName = bot.exchange || 'bingx';
        const credentials = user.exchange_credentials?.[exchangeName];

        if (!credentials || !credentials.api_key || !credentials.secret_key) {
            log.error('Нет ключей для биржи', { exchangeName });
            return { executed: false, reason: 'Нет ключей API' };
        }

        const exchangeClient = exchanges.getExchange(exchangeName, credentials.api_key, credentials.secret_key);
        if (!exchangeClient) {
            log.error('Биржа не поддерживается', { exchangeName });
            return { executed: false, reason: 'Биржа не поддерживается' };
        }

        // 2. Проверяем позиции на бирже
        let positions = [];
        try {
            positions = await exchangeClient.getPositions();
        } catch (error) {
            log.error('Ошибка получения позиций', { error: error.message });
            return { executed: false, reason: 'Ошибка получения позиций' };
        }

        const position = positions.find(p =>
            p.symbol === signal.symbol ||
            p.symbol === signal.symbol.replace('-', '')
        );

        // 3. Если позиции нет — открываем новую
        if (!position) {
            log.info(`📈 Исполнение нового сигнала ${signal.symbol} для ${user.email}`);
            const result = await executeSignal(signal, bot, user, supabase);

            if (result.executed) {
                await supabase
                    .from('signals')
                    .update({ executed: true })
                    .eq('id', signal.id);
            }

            return result;
        }

        // 4. Если позиция есть — определяем направление
        const signalSide = signal.side === 'LONG' ? 'LONG' : 'SHORT';
        const positionSide = position.positionSide;

        if (signalSide === positionSide) {
            // Одно направление
            await handleSameDirectionSignal(signal, position, bot, user, exchangeClient);
            return { executed: true, reason: 'Обработан как улучшение позиции' };
        } else {
            // Противоположное направление
            await handleOppositeSignal(signal, position, bot, user, exchangeClient);
            return { executed: true, reason: 'Обработан как противоположный сигнал' };
        }

    } catch (error) {
        log.error('Ошибка в executeSignalWithManagement', { error: error.message });
        return { executed: false, reason: error.message };
    }
}

// ============================================
//  МОНИТОРИНГ НОВЫХ И PENDING СИГНАЛОВ
// ============================================

async function checkNewSignals() {
    log.debug('🔄 Проверка новых сигналов');

    try {
        // 1. Сначала очищаем устаревшие
        await cleanupExpiredSignals();

        // 2. Получаем НЕ исполненные сигналы
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

        // 3. Группируем сигналы по монетам
        const signalsBySymbol = {};
        for (const signal of signals) {
            if (!signalsBySymbol[signal.symbol]) {
                signalsBySymbol[signal.symbol] = [];
            }
            signalsBySymbol[signal.symbol].push(signal);
        }

        // 4. Для каждой монеты выбираем лучший сигнал
        for (const symbol in signalsBySymbol) {
            const symbolSignals = signalsBySymbol[symbol];
            const bestSignal = getBestSignalForSymbol(symbolSignals);

            if (!bestSignal) continue;

            // 5. Получаем пользователя
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('id', bestSignal.user_id)
                .single();

            if (userError || !user) {
                log.error('Пользователь не найден', { userId: bestSignal.user_id });
                continue;
            }

            // 6. Получаем активные боты
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

            // 7. Исполняем лучший сигнал для каждого бота
            for (const bot of activeBots) {
                const signalLevels = bot.risk?.signal_levels || ['low', 'medium', 'high'];
                if (!signalLevels.includes(bestSignal.confidence)) {
                    log.debug(`Уровень сигнала ${bestSignal.confidence} не подходит для бота ${bot.name}`);
                    continue;
                }

                await executeSignalWithManagement(bestSignal, bot, user);
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ORDERS));
            }
        }

        consecutiveErrors = 0;

    } catch (err) {
        log.error('Ошибка в мониторинге', { error: err.message });
        await notifier.notifyError(`Ошибка в мониторинге: ${err.message}`, 'Trade Executor');
        consecutiveErrors++;
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
}

// ============================================
//  ЗАПУСК
// ============================================

log.info('⏰ Trade Executor: Запущен (мониторинг каждые 30 секунд)');
log.info('📋 Режим: умное управление позициями, переворот по сигналам');

setInterval(checkNewSignals, CHECK_INTERVAL);

// Первый запуск сразу
checkNewSignals();