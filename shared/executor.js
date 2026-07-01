// ============================================
//  ИСПОЛНИТЕЛЬ ТОРГОВЫХ СИГНАЛОВ (EXECUTOR)
// ============================================

const axios = require('axios');
const crypto = require('crypto');
const { decrypt } = require('./exchange');

/**
 * Исполнение сигнала (открытие сделки)
 * @param {object} signal - Сигнал из БД
 * @param {object} bot - Конфигурация бота
 * @param {object} user - Пользователь (с ключами)
 * @param {object} supabase - Инстанс Supabase
 * @returns {Promise<object>} - Результат исполнения
 */
async function executeSignal(signal, bot, user, supabase) {
    try {
        // 1. Проверяем, что бот активен и не на паузе
        if (!bot.active || bot.paused) {
            return { executed: false, reason: 'Бот не активен или на паузе' };
        }

        // 2. Проверяем режим бота
        if (bot.mode !== 'auto_trade' && bot.mode !== 'hybrid') {
            return { executed: false, reason: 'Режим бота не предусматривает автоторговлю' };
        }

        // 3. Проверяем наличие API-ключей
        const exchange = bot.exchange;
        const credentials = user.exchange_credentials?.[exchange];
        if (!credentials || !credentials.api_key_encrypted || !credentials.secret_key_encrypted) {
            return { executed: false, reason: `Нет API-ключей для ${exchange}` };
        }

        // 4. Расшифровываем ключи
        const apiKey = decrypt(credentials.api_key_encrypted, credentials.iv);
        const secretKey = decrypt(credentials.secret_key_encrypted, credentials.iv);

        // 5. Получаем текущий баланс пользователя
        const balance = await getExchangeBalance(exchange, apiKey, secretKey);
        if (balance === null) {
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

        // 8. Отправляем ордер на биржу
        console.log(`📊 Исполнение ${signal.side} для ${signal.symbol} на ${exchange}: ${position.quantity} по ${entryPrice}`);
        console.log(`   Стоп-лосс: ${position.stopLoss}, Тейк-профит: ${position.takeProfit}`);

        const orderResult = await placeOrder(
            exchange,
            apiKey,
            secretKey,
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

/**
 * Получение баланса с биржи
 */
async function getExchangeBalance(exchange, apiKey, secretKey) {
    try {
        switch (exchange) {
            case 'bingx':
                return await getBingXBalance(apiKey, secretKey);
            case 'binance':
                return await getBinanceBalance(apiKey, secretKey);
            default:
                return null;
        }
    } catch (error) {
        console.error(`❌ Ошибка получения баланса ${exchange}:`, error.message);
        return null;
    }
}

/**
 * Баланс BingX
 */
async function getBingXBalance(apiKey, secretKey) {
    try {
        const crypto = require('crypto');
        const axios = require('axios');

        const timestamp = Date.now().toString();
        const payload = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', secretKey)
            .update(payload)
            .digest('hex');

        const url = `https://open-api.bingx.com/openApi/swap/v3/user/balance?${payload}&signature=${signature}`;

        const response = await axios.get(url, {
            headers: { 'X-BX-APIKEY': apiKey },
            timeout: 10000
        });

        if (response.data && response.data.code === 0 && response.data.data) {
            const usdtData = response.data.data.find(item => item.asset === 'USDT');
            if (usdtData) {
                return parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
            }
            return 0;
        }
        return 0;
    } catch (error) {
        console.error('❌ Ошибка получения баланса BingX:', error.message);
        return null;
    }
}

/**
 * Баланс Binance
 */
async function getBinanceBalance(apiKey, secretKey) {
    const timestamp = Date.now();
    const signature = crypto.createHmac('sha256', secretKey)
        .update(`timestamp=${timestamp}&recvWindow=5000`)
        .digest('hex');

    const response = await axios.get(
        `https://api.binance.com/api/v3/account?timestamp=${timestamp}&signature=${signature}`,
        { headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000 }
    );

    if (response.data && response.data.balances) {
        const usdtBalance = response.data.balances.find(b => b.asset === 'USDT');
        return usdtBalance ? parseFloat(usdtBalance.free) : 0;
    }
    return null;
}

/**
 * Создание ордера на бирже
 */
async function placeOrder(exchange, apiKey, secretKey, symbol, side, quantity, price) {
    try {
        switch (exchange) {
            case 'bingx':
                return await placeBingXOrder(apiKey, secretKey, symbol, side, quantity, price);
            case 'binance':
                return await placeBinanceOrder(apiKey, secretKey, symbol, side, quantity, price);
            default:
                return null;
        }
    } catch (error) {
        console.error(`❌ Ошибка создания ордера ${exchange}:`, error.message);
        return null;
    }
}

/**
 * Ордер на BingX
 */
async function placeBingXOrder(apiKey, secretKey, symbol, side, quantity, price) {
    const timestamp = Date.now().toString();
    const formattedSymbol = symbol.replace('-', '_');

    // Для BingX используем рыночный ордер
    const params = {
        symbol: formattedSymbol,
        side: side,
        type: 'MARKET',
        quantity: quantity.toString()
    };

    const queryString = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const signature = crypto.createHmac('sha256', secretKey)
        .update(timestamp + queryString)
        .digest('hex');

    const response = await axios.post(
        'https://open-api.bingx.com/openApi/spot/v1/trade/order',
        params,
        {
            headers: {
                'X-BX-APIKEY': apiKey,
                'X-BX-SIGNATURE': signature,
                'X-BX-TIMESTAMP': timestamp,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        }
    );

    if (response.data && response.data.code === 0) {
        return {
            orderId: response.data.data.orderId,
            symbol: symbol,
            side: side,
            quantity: quantity,
            price: price,
            status: 'filled'
        };
    }
    return null;
}

/**
 * Ордер на Binance
 */
async function placeBinanceOrder(apiKey, secretKey, symbol, side, quantity, price) {
    const timestamp = Date.now();
    const formattedSymbol = symbol.replace('-', '');

    const params = {
        symbol: formattedSymbol,
        side: side,
        type: 'MARKET',
        quantity: quantity,
        timestamp: timestamp,
        recvWindow: 5000
    };

    const queryString = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&');

    const signature = crypto.createHmac('sha256', secretKey)
        .update(queryString)
        .digest('hex');

    const response = await axios.post(
        `https://api.binance.com/api/v3/order?${queryString}&signature=${signature}`,
        {},
        { headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000 }
    );

    if (response.data && response.data.orderId) {
        return {
            orderId: response.data.orderId,
            symbol: symbol,
            side: side,
            quantity: quantity,
            price: price,
            status: response.data.status
        };
    }
    return null;
}

module.exports = {
    executeSignal
};