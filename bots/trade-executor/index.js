// ============================================
//  МОДУЛЬ АВТОТОРГОВЛИ (TRADE EXECUTOR)
// ============================================

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const notifier = require('../../shared/notifier');

// === ИСПРАВЛЕНИЕ ДЛЯ WEBSOCKET (Node.js 20) ===
const WebSocket = require('ws');
global.WebSocket = WebSocket;
// =============================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ Ошибка: SUPABASE_URL и SUPABASE_KEY не заданы");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log("✅ Trade Executor: Подключение к Supabase установлено");

// ============================================
//  ИМПОРТ ОБЩЕЙ ЛОГИКИ
// ============================================

const { executeSignal } = require('../../shared/executor');

// ============================================
//  МОНИТОРИНГ НОВЫХ СИГНАЛОВ
// ============================================

const MAX_SIGNALS_PER_BATCH = 1;
const DELAY_BETWEEN_ORDERS = 2000;

async function checkNewSignals() {
    try {
        const { data: signals, error } = await supabase
            .from('signals')
            .select('*')
            .eq('executed', false)
            .order('created_at', { ascending: true })
            .limit(MAX_SIGNALS_PER_BATCH);

        if (error) {
            console.error('❌ Trade Executor: Ошибка получения сигналов:', error);
            await notifier.notifyError(`Ошибка получения сигналов: ${error.message}`, 'Supabase');
            return;
        }

        if (signals.length === 0) {
            return;
        }

        console.log(`📡 Trade Executor: Найдено ${signals.length} новых сигналов`);

        for (const signal of signals) {
            try {
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('*')
                    .eq('id', signal.user_id)
                    .single();

                if (userError || !user) {
                    console.error(`❌ Trade Executor: Пользователь ${signal.user_id} не найден`);
                    await notifier.notifyError(`Пользователь ${signal.user_id} не найден`, `Сигнал ${signal.id}`);
                    continue;
                }

                console.log(`👤 Пользователь: ${user.email}, Ботов: ${user.bots?.length || 0}`);

                const bots = user.bots || [];
                const activeBots = bots.filter(bot => 
                    bot.active && 
                    !bot.paused && 
                    (bot.mode === 'auto_trade' || bot.mode === 'hybrid')
                );

                console.log(`🤖 Активных ботов в режиме auto_trade/hybrid: ${activeBots.length}`);

                if (activeBots.length === 0) {
                    console.log(`⚠️ Trade Executor: Нет активных ботов для пользователя ${user.email}`);
                    continue;
                }

                for (const bot of activeBots) {
                    const signalLevels = bot.risk?.signal_levels || ['low', 'medium', 'high'];
                    if (!signalLevels.includes(signal.confidence)) {
                        console.log(`⏭️ Trade Executor: Уровень сигнала ${signal.confidence} не подходит для бота ${bot.name}`);
                        continue;
                    }

                    console.log(`📈 Trade Executor: Исполнение сигнала ${signal.symbol} для ${user.email}`);

                    const result = await executeSignal(signal, bot, user, supabase);
                    
                    if (result.executed) {
                        console.log(`✅ Trade Executor: Сделка открыта для ${user.email} (${signal.symbol})`);
                        // 🔔 Уведомление об успешной сделке
                        await notifier.notifyTrade(signal, result.trade);
                    } else {
                        console.log(`⚠️ Trade Executor: Сделка не открыта: ${result.reason}`);
                        // 🔔 Уведомление об ошибке
                        await notifier.notifyError(
                            `Сделка не открыта: ${result.reason}`,
                            `${signal.symbol} | ${signal.side} | Пользователь: ${user.email}`
                        );
                    }

                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_ORDERS));
                }

            } catch (err) {
                console.error(`❌ Trade Executor: Ошибка обработки сигнала ${signal.id}:`, err.message);
                await notifier.notifyError(
                    `Ошибка обработки сигнала ${signal.id}: ${err.message}`,
                    `Сигнал: ${signal.symbol} | ${signal.side}`
                );
            }
        }

    } catch (err) {
        console.error('❌ Trade Executor: Ошибка в мониторинге:', err.message);
        await notifier.notifyError(`Ошибка в мониторинге: ${err.message}`, 'Trade Executor');
    }
}

// ============================================
//  ЗАПУСК МОНИТОРИНГА (каждые 10 секунд)
// ============================================

console.log('⏰ Trade Executor: Запущен (мониторинг каждые 10 секунд)');

setInterval(checkNewSignals, 10000);

// Первый запуск сразу
checkNewSignals();