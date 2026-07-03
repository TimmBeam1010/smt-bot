// ============================================
//  ИСПОЛНИТЕЛЬ СДЕЛОК (EXECUTOR)
// ============================================

const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

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
console.log("✅ Подключение к Supabase установлено");

// ============================================
//  ИМПОРТ МОДУЛЕЙ БИРЖ
// ============================================

const exchanges = require('../shared/exchanges');

// ============================================
//  МИНИМАЛЬНЫЕ РАЗМЕРЫ ОРДЕРОВ ДЛЯ BINGX
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
    'FDUSD-USDT': null, // Не поддерживается
    'USDC-USDT': null, // Не поддерживается
    'DAI-USDT': null, // Не поддерживается
};

// ============================================
//  ИСПОЛНЕНИЕ СИГНАЛА
// ============================================

async function executeSignal(signal, bot, user, supabase) {
    try {
        // 1. Проверяем, есть ли уже открытая позиция
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

        // 2. Получаем ключи пользователя для биржи
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

        // 6. Рассчитываем позицию
        const riskPercent = bot.risk?.risk_percent || 2.0;
        const stopLossPercent = bot.risk?.stop_loss_percent || 1.5;
        
        const position = calculatePositionSize(
            balance,
            riskPercent,
            stopLossPercent,
            entryPrice,
            signal.symbol
        );

        // Проверяем, что позиция не нулевая
        if (position.quantity <= 0) {
            console.error(`❌ Рассчитанный размер позиции = 0`);
            return { executed: false, reason: 'Некорректный размер позиции' };
        }

        // 7. Определяем сторону ордера
        const orderSide = signal.side === 'LONG' ? 'BUY' : 'SELL';

        // 8. Отправляем MARKET ордер (без цены)
        console.log(`📊 Исполнение ${signal.side} для ${signal.symbol} на ${exchangeName}: ${position.quantity} по ${entryPrice}`);
        console.log(`   Стоп-лосс: ${position.stopLoss}, Тейк-профит: ${position.takeProfit}`);

        const orderResult = await exchangeClient.placeOrder(
            signal.symbol,
            orderSide,
            position.quantity,
            null,  // MARKET ордер без цены
            position.stopLoss.toString(),
            position.takeProfit.toString()
        );

        if (!orderResult || !orderResult.orderId) {
            console.error(`❌ Ошибка создания ордера:`, orderResult);
            return { executed: false, reason: 'Ошибка создания ордера' };
        }

        // 9. Сохраняем сделку в БД
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
                stop_loss: position.stopLoss,
                take_profit: position.takeProfit,
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

        // 10. Обновляем сигнал
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
//  РАСЧЁТ РАЗМЕРА ПОЗИЦИИ (в монетах)
// ============================================

function calculatePositionSize(balance, riskPercent, stopLossPercent, entryPrice, symbol) {
    const riskAmount = balance * (riskPercent / 100);
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    const priceDiff = entryPrice - stopLossPrice;
    let quantity = riskAmount / priceDiff;

    // Проверяем минимальный размер для конкретной монеты
    const minSize = MIN_ORDER_SIZE[symbol];
    
    // Если монета не поддерживается — пропускаем
    if (minSize === null) {
        console.error(`❌ Монета ${symbol} не поддерживается на BingX (пропуск)`);
        return { quantity: 0, stopLoss: 0, takeProfit: 0 };
    }

    // Устанавливаем минимальный размер по умолчанию
    const minOrderSize = minSize || 0.0001;

    if (quantity < minOrderSize) {
        quantity = minOrderSize;
        console.log(`⚠️ Корректировка: минимальный размер для ${symbol} = ${minOrderSize}`);
    }

    // Округляем до 8 знаков
    const roundedQuantity = Math.round(quantity * 100000000) / 100000000;

    // Проверяем, что после округления не стало 0
    if (roundedQuantity <= 0) {
        console.error(`❌ Ошибка: рассчитанный размер позиции = 0 после округления`);
        return { quantity: 0, stopLoss: 0, takeProfit: 0 };
    }

    return {
        quantity: roundedQuantity,
        stopLoss: Math.round(stopLossPrice * 100) / 100,
        takeProfit: Math.round(entryPrice * (1 + stopLossPercent * 2 / 100) * 100) / 100
    };
}

// ============================================
//  ЭКСПОРТ
// ============================================

module.exports = {
    executeSignal,
    calculatePositionSize
};