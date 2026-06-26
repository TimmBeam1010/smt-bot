// trading.js — модуль для работы с BingX и анализа (ПОРОГИ МИНИМАЛЬНЫЕ ДЛЯ ТЕСТА)
const axios = require('axios');

// --- ПОЛУЧЕНИЕ ЦЕНЫ ---
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
        console.warn(`⚠️ Не удалось получить цену для ${symbol}:`, data);
        return null;
    } catch (error) {
        console.error(`❌ Ошибка получения цены ${symbol}:`, error.message);
        return null;
    }
}

// --- ПОЛУЧЕНИЕ НЕСКОЛЬКИХ ЦЕН ---
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

// --- РАСЧЁТ RSI ---
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

// --- РАСЧЁТ MACD (упрощённый) ---
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

// --- ГЕНЕРАЦИЯ СИГНАЛА (МИНИМАЛЬНЫЕ ПОРОГИ) ---
function generateSignal(symbol, prices) {
    // --- ВРЕМЕННО МЕНЯЕМ С 20 НА 5 ДЛЯ ТЕСТА ---
    if (prices.length < 5) return null;

    const lastPrice = prices[prices.length - 1];
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const volatility = Math.sqrt(prices.map(p => Math.pow(p - avgPrice, 2)).reduce((a, b) => a + b, 0) / prices.length);

    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);

    let side = null;
    let confidence = 'low';
    const reasons = [];

    // Условия для LONG (МИНИМАЛЬНЫЙ ПОРОГ)
    let longConditions = 0;
    if (lastPrice < avgPrice - volatility * 0.1) {
        longConditions++;
        reasons.push('цена ниже средней');
    }
    if (rsi !== null && rsi < 60) {
        longConditions++;
        reasons.push(`RSI (${rsi.toFixed(1)}) ниже 60`);
    }
    if (macd !== null && macd.histogram < 0) {
        longConditions++;
        reasons.push('MACD ниже нуля');
    }

    // Условия для SHORT (МИНИМАЛЬНЫЙ ПОРОГ)
    let shortConditions = 0;
    if (lastPrice > avgPrice + volatility * 0.1) {
        shortConditions++;
        reasons.push('цена выше средней');
    }
    if (rsi !== null && rsi > 40) {
        shortConditions++;
        reasons.push(`RSI (${rsi.toFixed(1)}) выше 40`);
    }
    if (macd !== null && macd.histogram > 0) {
        shortConditions++;
        reasons.push('MACD выше нуля');
    }

    // ДОСТАТОЧНО 1 УСЛОВИЯ
    if (longConditions >= 1) {
        side = 'LONG';
        confidence = longConditions >= 2 ? 'high' : 'medium';
    } else if (shortConditions >= 1) {
        side = 'SHORT';
        confidence = shortConditions >= 2 ? 'high' : 'medium';
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