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
//  ГЕНЕРАЦИЯ СИГНАЛОВ
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

            for (const bot of activeBots) {
                const symbols = bot.symbols || ['BTC-USDT'];

                for (const symbol of symbols) {
                    try {
                        // TODO: реальная логика генерации сигналов
                        const side = Math.random() > 0.5 ? 'LONG' : 'SHORT';
                        const confidence = ['low', 'medium', 'high'][Math.floor(Math.random() * 3)];
                        const entryPrice = 60000 + Math.random() * 1000;

                        const { data: signal, error: signalError } = await supabase
                            .from('signals')
                            .insert({
                                user_id: user.id,
                                symbol: symbol,
                                side: side,
                                confidence: confidence,
                                entry_price: entryPrice,
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
                            signalId: signal.id
                        });

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

log.info('⏰ Signal Generator: Запущен (каждые 30 секунд)');

setInterval(generateSignals, SIGNAL_INTERVAL);
generateSignals();