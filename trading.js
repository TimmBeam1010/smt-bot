const axios = require('axios');

async function getPrice(symbol) {
    try {
        const formattedSymbol = symbol.replace('-', '_');
        const url = `https://open-api.bingx.com/openApi/spot/v1/ticker/price?symbol=${formattedSymbol}`;
        const response = await axios.get(url, { timeout: 10000 });
        const data = response.data;

        if (data.data && data.data.length > 0) {
            const trade = data.data[0].trades[0];
            if (trade && trade.price) {
                return parseFloat(trade.price);
            }
        }
        if (data.price) {
            return parseFloat(data.price);
        }
        return null;
    } catch (error) {
        console.error(`❌ Ошибка получения цены ${symbol}:`, error.message);
        return null;
    }
}

async function getPrices(symbols) {
    const results = {};
    for (const symbol of symbols) {
        const price = await getPrice(symbol);
        if (price !== null) {
            results[symbol] = price;
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return results;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const deltas = [];
    for (let i = 1; i < prices.length; i++) {
        deltas.push(prices[i] - prices[i - 1]);
    }
    const gains = deltas.map(d => d > 0 ? d : 0);
    const losses = deltas.map(d => d < 0 ? -d : 0);

    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
    if (prices.length < slow + signal) return null;
    const emaFast = prices.slice(-fast).reduce((a, b) => a + b, 0) / fast;
    const emaSlow = prices.slice(-slow).reduce((a, b) => a + b, 0) / slow;
    const macdLine = emaFast - emaSlow;
    const signalLine = prices.slice(-signal).reduce((a, b) => a + b, 0) / signal;
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: macdLine - signalLine
    };
}

function generateSignal(symbol, prices) {
    if (prices.length < 20) return null;

    const lastPrice = prices[prices.length - 1];
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const volatility = Math.sqrt(prices.map(p => Math.pow(p - avgPrice, 2)).reduce((a, b) => a + b, 0) / prices.length);

    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);

    let side = null;
    let confidence = 'low';
    const reasons = [];

    let longConditions = 0;
    if (lastPrice < avgPrice - volatility * 1.2) {
        longConditions++;
        reasons.push('цена ниже средней');
    }
    if (rsi !== null && rsi < 30) {
        longConditions++;
        reasons.push(`RSI (${rsi.toFixed(1)}) перепродан`);
    }
    if (macd !== null && macd.histogram < 0 && macd.macd > macd.signal) {
        longConditions++;
        reasons.push('MACD разворачивается вверх');
    }

    let shortConditions = 0;
    if (lastPrice > avgPrice + volatility * 1.2) {
        shortConditions++;
        reasons.push('цена выше средней');
    }
    if (rsi !== null && rsi > 70) {
        shortConditions++;
        reasons.push(`RSI (${rsi.toFixed(1)}) перекуплен`);
    }
    if (macd !== null && macd.histogram > 0 && macd.macd < macd.signal) {
        shortConditions++;
        reasons.push('MACD разворачивается вниз');
    }

    if (longConditions >= 2) {
        side = 'LONG';
        confidence = longConditions >= 3 ? 'high' : 'medium';
    } else if (shortConditions >= 2) {
        side = 'SHORT';
        confidence = shortConditions >= 3 ? 'high' : 'medium';
    } else {
        return null;
    }

    return {
        symbol,
        side,
        entry: lastPrice,
        confidence,
        reasons,
        rsi: rsi !== null ? parseFloat(rsi.toFixed(1)) : null,
        macd: macd !== null ? parseFloat(macd.histogram.toFixed(6)) : null,
        timestamp: new Date().toISOString()
    };
}

module.exports = { getPrice, getPrices, generateSignal };