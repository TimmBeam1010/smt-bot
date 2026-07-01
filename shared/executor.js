// ============================================
//  ИСПОЛНИТЕЛЬ СДЕЛОК (EXECUTOR)
// ============================================

const { getExchange } = require('./exchanges');

/**
 * Исполнение сигнала (открытие сделки)
 */
async function executeSignal(signal, bot, user, supabase) {
    try {
        // 1. Проверяем, что бот активен
        if (!bot.active || bot.paused) {
            return { executed: false, reason: 'Бот не активен или на паузе' };
        }

        // 2. Проверяем режим бота
        if (bot.mode !== 'auto_trade' && bot.mode !== 'hybrid') {
            return { executed: false, reason: 'Режим бота не предусматривает автоторговлю' };
        }

        // 3. Получаем ключи пользователя
        const exchange = bot.exchange;
        const credentials = user.exchange_credentials?.[exchange];

        // Логируем для отладки
        console.log('🔑 Получены credentials:', JSON.stringify(credentials, null, 2));

        if (!credentials) {
            return { executed: false, reason: `Нет credentials для ${exchange}` };
        }

        // Проверяем наличие ключей в разных форматах
        const apiKey = credentials.api_key || credentials.apiKey || credentials.api_key_encrypted;
        const secretKey = credentials.secret_key || credentials.secretKey || credentials.secret_key_encrypted;

        if (!apiKey || !secretKey) {
            console.error('❌ Не найдены ключи в credentials:', Object.keys(credentials));
            return { executed: false, reason: `Нет API-ключей для ${exchange}` };
        }

        // 4. Создаём клиент биржи через фабрику
        const exchangeClient = getExchange(exchange, apiKey, secretKey);

        // 5. Получаем баланс
        const balance = await exchangeClient.getBalance();
        if (balance === null || balance === undefined) {
            return { executed: false, reason: 'Не удалось получить баланс' };
        }

        // 6. Рассчитываем размер позиции
        const entryPrice = parseFloat(signal.entry_price);
        const riskPercent = bot.risk?.risk_percent || 2.0;
        const stopLossPercent = bot.risk?.stop_loss_percent || 1.5;
        const takeProfitPercent = bot.risk?.take_profit_percent || 3.0;

        const position = calculatePositionSize(
            balance,
            riskPercent,
            stopLossPercent,
            entryPrice
        );

        // 7. Определяем сторону ордера
        const orderSide = signal.side === 'LONG' ? 'BUY' : 'SELL';

        // 8. Отправляем ордер
        console.log(`📊 Исполнение ${signal.side} для ${signal.symbol} на ${exchange}: ${position.quantity} по ${entryPrice}`);
        console.log(`   Стоп-лосс: ${position.stopLoss}, Тейк-профит: ${position.takeProfit}`);

        const orderResult = await exchangeClient.placeOrder(
            signal.symbol,
            orderSide,
            position.quantity,
            entryPrice
        );

        if (!orderResult || !orderResult.orderId) {
            return { executed: false, reason: 'Ошибка создания ордера' };
        }

        // 9. Сохраняем сделку в БД
        const { data: trade, error: tradeError } = await supabase
            .from('trades')
            .insert({
                user_id: user.id,
                signal_id: signal.id,
                exchange: exchange,
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

        if (tradeError) {
            console.error(`❌ Ошибка сохранения сделки:`, tradeError);
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

/**
 * Расчёт размера позиции
 */
function calculatePositionSize(balance, riskPercent, stopLossPercent, entryPrice) {
    const riskAmount = balance * (riskPercent / 100);
    const stopLossPrice = entryPrice * (1 - stopLossPercent / 100);
    const priceDiff = entryPrice - stopLossPrice;
    const quantity = riskAmount / priceDiff;
    return {
        quantity: Math.round(quantity * 100) / 100,
        stopLoss: Math.round(stopLossPrice * 100) / 100,
        takeProfit: Math.round(entryPrice * (1 + stopLossPercent * 2 / 100) * 100) / 100
    };
}

module.exports = {
    executeSignal
};