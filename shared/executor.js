// ============================================
//  ИСПОЛНИТЕЛЬ СДЕЛОК (EXECUTOR)
// ============================================

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// === ИСПРАВЛЕНИЕ ДЛЯ WEBSOCKET ===
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
console.log("✅ Подключение к Supabase установлено");

const exchanges = require('../shared/exchanges');
const { calculatePositionLevels } = require('./position-calculator');

// ============================================
//  МИНИМАЛЬНЫЕ РАЗМЕРЫ ОРДЕРОВ
// ============================================

const MIN_ORDER_SIZE = {
    'SEI-USDT': 41,
    'DOT-USDT': 2.3,
    'XMR-USDT': 0.007,
    'STX-USDT': 12,
    'BTC-USDT': 0.0001,
    'ETH-USDT': 0.001,
    'BNB-USDT': 0.01,
    'SOL-USDT': 0.01,
    'XRP-USDT': 1,
    'ADA-USDT': 1,
    'DOGE-USDT': 10,
    'TRX-USDT': 10,
    'MATIC-USDT': 10,
    'LTC-USDT': 0.01,
    'AVAX-USDT': 0.01,
    'UNI-USDT': 0.1,
    'ATOM-USDT': 0.1,
    'LINK-USDT': 0.1,
    'ETC-USDT': 0.1,
    'XLM-USDT': 10,
    'BCH-USDT': 0.01,
    'ALGO-USDT': 10,
    'VET-USDT': 100,
    'ICP-USDT': 0.1,
    'FIL-USDT': 0.1,
    'EGLD-USDT': 0.01,
    'THETA-USDT': 1,
    'HNT-USDT': 0.1,
    'ARB-USDT': 1,
    'MKR-USDT': 0.001,
    'AAVE-USDT': 0.01,
    'APE-USDT': 1,
    'QNT-USDT': 0.01,
    'FTM-USDT': 1,
    'RNDR-USDT': 0.1,
    'SNX-USDT': 1,
    'MANA-USDT': 1,
    'SAND-USDT': 1,
    'GALA-USDT': 10,
    'AXS-USDT': 0.1,
    'ENJ-USDT': 1,
    'BONK-USDT': 1000,
    'DOGS-USDT': 1000,
    'PEPE-USDT': 1000,
    'WIF-USDT': 1,
    'FLOKI-USDT': 1000,
    'NOT-USDT': 10,
    'JUP-USDT': 1,
    'JTO-USDT': 1,
    'PYTH-USDT': 1,
    'TIA-USDT': 1,
    'SUI-USDT': 1,
    'APT-USDT': 1,
    'OP-USDT': 1,
    'LDO-USDT': 1,
    'AR-USDT': 1,
    'RUNE-USDT': 1,
    'KAS-USDT': 10,
    'CFX-USDT': 10,
    'CORE-USDT': 10,
    'CRV-USDT': 1,
    'CVX-USDT': 1,
    'BAL-USDT': 1,
    'YFI-USDT': 0.001,
    'COMP-USDT': 0.01,
    'SUSHI-USDT': 1,
    '1INCH-USDT': 1,
    'CAKE-USDT': 1,
    'BAKE-USDT': 1,
    'DODO-USDT': 10,
    'GRT-USDT': 10,
    'LPT-USDT': 1,
    'RLC-USDT': 1,
    'IOTX-USDT': 10,
    'IOTA-USDT': 10,
    'NEO-USDT': 0.1,
    'ONT-USDT': 10,
    'VTHO-USDT': 100,
    'HOT-USDT': 100,
    'ILV-USDT': 0.01,
    'YGG-USDT': 10,
    'ALICE-USDT': 1,
    'TLM-USDT': 10,
    'SIDUS-USDT': 10,
    'MEME-USDT': 10,
    'PEPE2-USDT': 1000,
    'WOJAK-USDT': 1000,
    'TOSHI-USDT': 1000,
    'FDUSD-USDT': null,
    'USDC-USDT': null,
    'DAI-USDT': null,
};

// ============================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

async function getCandles(symbol, exchangeClient) {
    try {
        // 🔧 ПОЛУЧАЕМ РЕАЛЬНЫЕ СВЕЧИ С БИРЖИ
        const candles = await exchangeClient.getCandles(symbol, '5m', 50);
        if (!candles || candles.length === 0) {
            console.warn('⚠️ Не удалось получить свечи для', symbol);
            return [];
        }
        console.log(`📊 Получено ${candles.length} свечей для ${symbol}`);
        return candles;
    } catch (error) {
        console.error('❌ Ошибка получения свечей:', error.message);
        return [];
    }
}

async function getIndicators(candles) {
    try {
        if (!candles || candles.length < 20) {
            return { atr: 0 };
        }

        // Рассчитываем ATR (Average True Range)
        let atr = 0;
        const period = 14;
        const trueRanges = [];

        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;
            const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            trueRanges.push(tr);
        }

        if (trueRanges.length >= period) {
            const sum = trueRanges.slice(-period).reduce((a, b) => a + b, 0);
            atr = sum / period;
        }

        console.log('📊 Рассчитаны индикаторы:', { atr });
        return { atr };
    } catch (error) {
        console.error('❌ Ошибка расчёта индикаторов:', error.message);
        return { atr: 0 };
    }
}

// ============================================
//  ИСПОЛНЕНИЕ СИГНАЛА
// ============================================

async function executeSignal(signal, bot, user, supabase) {
    try {
        // 1. Проверяем открытые позиции
        const { data: openTrades, error: tradeError } = await supabase
            .from('trades')
            .select('*')
            .eq('user_id', user.id)
            .eq('symbol', signal.symbol)
            .eq('status', 'open');

        if (tradeError) {
            console.error('❌ Ошибка проверки открытых позиций:', tradeError);
            return { executed: false, reason: 'Ошибка проверки позиций' };
        }

        if (openTrades && openTrades.length > 0) {
            console.log(`⏭️ Уже есть открытая позиция по ${signal.symbol}`);
            return { executed: false, reason: 'Уже есть открытая позиция' };
        }

        // 2. Получаем ключи пользователя
        const exchangeName = bot.exchange || 'bingx';
        const credentials = user.exchange_credentials?.[exchangeName];
        
        if (!credentials || !credentials.api_key || !credentials.secret_key) {
            console.error(`❌ Нет ключей для биржи ${exchangeName}`);
            return { executed: false, reason: 'Нет ключей API' };
        }

        // 3. Создаём клиент биржи
        const exchangeClient = exchanges.getExchange(exchangeName, credentials.api_key, credentials.secret_key);
        if (!exchangeClient) {
            console.error(`❌ Биржа ${exchangeName} не поддерживается`);
            return { executed: false, reason: 'Биржа не поддерживается' };
        }

        // 4. Получаем баланс
        const balance = await exchangeClient.getBalance();
        if (balance === null || balance === undefined) {
            console.error(`❌ Не удалось получить баланс для ${user.email}`);
            return { executed: false, reason: 'Не удалось получить баланс' };
        }

        // 5. Получаем цену входа
        const entryPrice = parseFloat(signal.entry_price);
        if (!entryPrice || entryPrice <= 0) {
            console.error(`❌ Некорректная цена входа: ${signal.entry_price}`);
            return { executed: false, reason: 'Некорректная цена' };
        }

        // ============================================
        //  🔧 НОВАЯ ЛОГИКА: РАСЧЁТ TP/SL ДИНАМИЧЕСКИ
        // ============================================

        // 6. Получаем свечи и индикаторы
        const candles = await getCandles(signal.symbol, exchangeClient);
        const indicators = await getIndicators(candles);

        // 7. Рассчитываем TP/SL на основе рыночной структуры
        const positionLevels = calculatePositionLevels(
            signal.symbol,
            entryPrice,
            candles,
            indicators,
            signal.side,
            { minRatio: 2.0 }
        );

        if (!positionLevels.valid) {
            console.warn(`⚠️ Соотношение риск/прибыль ${positionLevels.ratio}:1 ниже минимального (2:1)`);
            return { executed: false, reason: 'Низкое соотношение риск/прибыль' };
        }

        console.log(`📊 Динамический расчёт TP/SL для ${signal.symbol}:`);
        console.log(`   Стоп-лосс: ${positionLevels.stopLoss} (риск: $${positionLevels.risk.toFixed(2)})`);
        console.log(`   Тейк-профит: ${positionLevels.takeProfit} (прибыль: $${positionLevels.reward.toFixed(2)})`);
        console.log(`   Соотношение: ${positionLevels.ratio}:1`);

        // ============================================
        //  РАСЧЁТ РАЗМЕРА ПОЗИЦИИ
        // ============================================

        const riskPercent = bot.risk?.risk_percent || 2.0;
        const position = calculatePositionSize(
            balance,
            riskPercent,
            entryPrice,
            positionLevels.stopLoss,
            signal.symbol
        );

        if (position.quantity <= 0) {
            console.error(`❌ Рассчитанный размер позиции = 0`);
            return { executed: false, reason: 'Некорректный размер позиции' };
        }

        // ============================================
        //  ОТПРАВКА ОРДЕРА
        // ============================================

        const orderSide = signal.side === 'LONG' ? 'BUY' : 'SELL';

        console.log(`📊 Исполнение ${signal.side} для ${signal.symbol} на ${exchangeName}: ${position.quantity} по ${entryPrice}`);
        console.log(`   Стоп-лосс: ${positionLevels.stopLoss}, Тейк-профит: ${positionLevels.takeProfit}`);

        const orderResult = await exchangeClient.placeOrder(
            signal.symbol,
            orderSide,
            position.quantity,
            null,
            positionLevels.stopLoss.toString(),
            positionLevels.takeProfit.toString()
        );

        if (!orderResult || !orderResult.orderId) {
            console.error(`❌ Ошибка создания ордера:`, orderResult);
            return { executed: false, reason: 'Ошибка создания ордера' };
        }

        // ============================================
        //  СОХРАНЕНИЕ СДЕЛКИ
        // ============================================

        const { data: trade, error: saveError } = await supabase
            .from('trades')
            .insert({
                user_id: user.id,
                signal_id: signal.id,
                exchange: exchangeName,
                symbol: signal.symbol,
                side: signal.side,
                entry_price: entryPrice,
                quantity: position.quantity,
                stop_loss: positionLevels.stopLoss,
                take_profit: positionLevels.takeProfit,
                risk_reward_ratio: positionLevels.ratio,
                status: 'open',
                open_time: new Date(),
                order_id: orderResult.orderId
            })
            .select()
            .single();

        if (saveError) {
            console.error(`❌ Ошибка сохранения сделки:`, saveError);
            return { executed: false, reason: 'Ошибка сохранения сделки' };
        }

        await supabase
            .from('signals')
            .update({ executed: true, executed_at: new Date() })
            .eq('id', signal.id);

        console.log(`✅ Сделка открыта: ${signal.symbol} ${signal.side} для пользователя ${user.email}`);

        return {
            executed: true,
            trade: trade,
            order: orderResult
        };

    } catch (error) {
        console.error(`❌ Ошибка исполнения сигнала:`, error.message);
        return { executed: false, reason: error.message };
    }
}

// ============================================
//  РАСЧЁТ РАЗМЕРА ПОЗИЦИИ
// ============================================

function calculatePositionSize(balance, riskPercent, entryPrice, stopLoss, symbol) {
    const riskAmount = balance * (riskPercent / 100);
    const priceDiff = entryPrice - stopLoss;
    let quantity = riskAmount / priceDiff;

    const minSize = MIN_ORDER_SIZE[symbol];
    if (minSize === null) {
        console.error(`❌ Монета ${symbol} не поддерживается`);
        return { quantity: 0 };
    }

    const minOrderSize = minSize || 0.0001;
    if (quantity < minOrderSize) {
        quantity = minOrderSize;
        console.log(`⚠️ Корректировка: минимальный размер для ${symbol} = ${minOrderSize}`);
    }

    const roundedQuantity = Math.round(quantity * 100000000) / 100000000;
    return { quantity: roundedQuantity };
}

module.exports = {
    executeSignal,
    calculatePositionSize
};