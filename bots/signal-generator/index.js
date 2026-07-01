// ============================================
//  МОДУЛЬ ГЕНЕРАЦИИ СИГНАЛОВ (SIGNAL GENERATOR)
// ============================================

const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

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
console.log("✅ Signal Generator: Подключение к Supabase установлено");

// ============================================
//  ИМПОРТ ОБЩЕЙ ЛОГИКИ
// ============================================

const { getUserAggregatedPrice, getAllUserExchanges, generateSignal } = require('../../shared/trading');

// ============================================
//  ХРАНИЛИЩЕ ИСТОРИИ ЦЕН
// ============================================

const userPriceHistory = {};

function getUserPriceHistory(userId, symbol) {
    if (!userPriceHistory[userId]) {
        userPriceHistory[userId] = {};
    }
    if (!userPriceHistory[userId][symbol]) {
        userPriceHistory[userId][symbol] = [];
    }
    return userPriceHistory[userId][symbol];
}

// ============================================
//  ПЛАНИРОВЩИК
// ============================================

cron.schedule('*/1 * * * *', async () => {
    const startTime = Date.now();
    console.log('🔄 Signal Generator: Запуск анализа...');

    try {
        // Получаем всех активных пользователей
        const userExchangesMap = await getAllUserExchanges(supabase);
        const userIds = Array.from(userExchangesMap.keys());

        if (userIds.length === 0) {
            console.log('⚠️ Signal Generator: Нет активных пользователей');
            return;
        }

        console.log(`👥 Signal Generator: Обрабатываем ${userIds.length} пользователей`);

        for (const userId of userIds) {
            try {
                // Получаем ботов пользователя
                const { data: user, error: userError } = await supabase
                    .from('users')
                    .select('bots, id, email')
                    .eq('id', userId)
                    .single();

                if (userError || !user) {
                    console.error(`❌ Signal Generator: Ошибка получения пользователя ${userId}:`, userError);
                    continue;
                }

                const bots = user.bots || [];
                const activeBots = bots.filter(bot => bot.active && !bot.paused);

                if (activeBots.length === 0) {
                    continue;
                }

                // Для каждого активного бота
                for (const bot of activeBots) {
                    // Получаем символы из бота, или используем дефолтные (все монеты)
                    let symbols = bot.symbols || [];
                    if (symbols.length === 0) {
                        symbols = [
                            'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT',
                            'ADA-USDT', 'DOGE-USDT', 'TRX-USDT', 'DOT-USDT', 'MATIC-USDT',
                            'SHIB-USDT', 'LTC-USDT', 'AVAX-USDT', 'UNI-USDT', 'ATOM-USDT',
                            'LINK-USDT', 'ETC-USDT', 'XLM-USDT', 'BCH-USDT', 'ALGO-USDT',
                            'VET-USDT', 'ICP-USDT', 'FIL-USDT', 'EGLD-USDT', 'THETA-USDT',
                            'HNT-USDT', 'XMR-USDT', 'ARB-USDT', 'MKR-USDT', 'AAVE-USDT',
                            'APE-USDT', 'QNT-USDT', 'FTM-USDT', 'RNDR-USDT', 'SNX-USDT',
                            'MANA-USDT', 'SAND-USDT', 'GALA-USDT', 'AXS-USDT', 'ENJ-USDT',
                            'BONK-USDT', 'DOGS-USDT', 'PEPE-USDT', 'WIF-USDT', 'FLOKI-USDT',
                            'NOT-USDT', 'JUP-USDT', 'JTO-USDT', 'PYTH-USDT', 'TIA-USDT',
                            'SEI-USDT', 'SUI-USDT', 'APT-USDT', 'OP-USDT', 'LDO-USDT',
                            'AR-USDT', 'RUNE-USDT', 'KAS-USDT', 'CFX-USDT', 'CORE-USDT',
                            'CRV-USDT', 'CVX-USDT', 'BAL-USDT', 'YFI-USDT', 'COMP-USDT',
                            'SUSHI-USDT', '1INCH-USDT', 'CAKE-USDT', 'BAKE-USDT', 'DODO-USDT',
                            'GRT-USDT', 'LPT-USDT', 'RLC-USDT', 'IOTX-USDT', 'IOTA-USDT',
                            'NEO-USDT', 'ONT-USDT', 'VTHO-USDT', 'HOT-USDT', 'STX-USDT',
                            'ILV-USDT', 'YGG-USDT', 'ALICE-USDT', 'TLM-USDT', 'SIDUS-USDT',
                            'MEME-USDT', 'PEPE2-USDT', 'WOJAK-USDT', 'TOSHI-USDT',
                            'USDC-USDT', 'DAI-USDT', 'FDUSD-USDT'
                        ];
                        console.log(`⚠️ Signal Generator: У бота ${bot.name || 'без названия'} нет символов, используем все монеты (${symbols.length})`);
                    }

                    const prices = {};
                    for (const symbol of symbols) {
                        const result = await getUserAggregatedPrice(userId, symbol, supabase);
                        if (result) {
                            prices[symbol] = result.price;
                        }
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }

                    for (const symbol of symbols) {
                        if (prices[symbol] !== undefined) {
                            const history = getUserPriceHistory(userId, symbol);
                            history.push(prices[symbol]);
                            if (history.length > 60) {
                                history.shift();
                            }
                        }
                    }

                    for (const symbol of symbols) {
                        const history = getUserPriceHistory(userId, symbol);
                        if (history.length >= 20) {
                            const signal = generateSignal(symbol, history);
                            if (signal) {
                                const signalLevels = bot.risk?.signal_levels || ['low', 'medium', 'high'];
                                if (!signalLevels.includes(signal.confidence)) {
                                    continue;
                                }

                                console.log(`📈 Signal Generator: СИГНАЛ для ${userId} (${symbol}): ${signal.side} (${signal.confidence})`);

                                try {
                                    const { error: insertError } = await supabase
                                        .from('signals')
                                        .insert({
                                            user_id: userId,
                                            symbol: signal.symbol,
                                            side: signal.side,
                                            entry_price: signal.entry,
                                            confidence: signal.confidence,
                                            reasons: signal.reasons,
                                            rsi: signal.rsi,
                                            macd: signal.macd,
                                            created_at: new Date()
                                        });

                                    if (insertError) {
                                        console.error(`❌ Signal Generator: Ошибка сохранения сигнала для ${userId}:`, insertError);
                                    }
                                } catch (dbError) {
                                    console.error(`❌ Signal Generator: Ошибка БД для ${userId}:`, dbError.message);
                                }
                            }
                        }
                    }
                }

            } catch (userError) {
                console.error(`❌ Signal Generator: Ошибка обработки пользователя ${userId}:`, userError.message);
            }
        }

        const duration = Date.now() - startTime;
        console.log(`✅ Signal Generator: Анализ завершён за ${duration}мс`);

    } catch (error) {
        console.error('❌ Signal Generator: Ошибка в планировщике:', error.message);
    }
}, {
    timezone: "Europe/Moscow"
});

console.log('⏰ Signal Generator: Запущен (каждую минуту)');