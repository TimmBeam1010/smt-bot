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

// ============================================
//  ИМПОРТ МОДУЛЕЙ БИРЖ
// ============================================

const exchanges = require('../shared/exchanges');

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
            entryPrice
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

        // 🔧 ИСПРАВЛЕНИЕ: stopLoss и takeProfit должны быть строками
        const orderResult = await exchangeClient.placeOrder(
            signal.symbol,
            orderSide,
            position.quantity,
            null,  // MARKET ордер без цены
            position.stopLoss.toString(),      // <-- СТРОКА
            position.takeProfit.toString()     // <-- СТРОКА
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
//  РАСЧЁТ РАЗМЕРА ПОЗИЦИИ
// ============================================

function calculatePositionSize(balance, riskPercent, stopLossPercent, entryPrice) {
    const riskAmount = balance * (riskPercent / 100);
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    const priceDiff = entryPrice - stopLossPrice;
    let quantity = riskAmount / priceDiff;
    
    // Минимальные ограничения BingX для BTC-USDT
    const minOrderValue = 2; // Минимальная стоимость ордера в USDT
    const minOrderSize = 0.0001; // Минимальный размер в BTC
    
    // Проверяем минимальную стоимость
    const orderValue = quantity * entryPrice;
    if (orderValue < minOrderValue) {
        quantity = minOrderValue / entryPrice;
        console.log(`⚠️ Корректировка: минимальная стоимость $${minOrderValue}, новый размер: ${quantity}`);
    }
    
    // Проверяем минимальный размер
    if (quantity < minOrderSize) {
        quantity = minOrderSize;
        console.log(`⚠️ Корректировка: минимальный размер ${minOrderSize} BTC`);
    }
    
    // Округляем до 8 знаков (минимальный шаг на BingX)
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