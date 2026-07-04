// ============================================
//  МОДУЛЬ СВЕДЕНИЯ (CONFLUENCE)
// ============================================

const fibonacci = require('./fibonacci');
const dominance = require('./dominance');
const marketMaker = require('./market-maker');

/**
 * Собрать все подтверждения для сигнала
 */
async function getConfluence(signal, marketData, context) {
    const reasons = [];
    let weight = signal.weight || 0;

    // 1. Фибоначчи
    if (context.high && context.low) {
        const fibLevels = fibonacci.getFibonacciLevels(context.high, context.low);
        const nearestFib = fibonacci.findNearestFibonacciLevel(signal.entry_price, fibLevels);
        if (nearestFib) {
            reasons.push(`Цена у уровня Фибоначчи ${nearestFib.name} (${nearestFib.level.toFixed(2)})`);
            weight += 10;
        }
    }

    // 2. Доминация
    try {
        const btcDominance = await dominance.getBtcDominance();
        const dominanceWeight = dominance.adjustSignalByDominance(signal, btcDominance);
        weight = weight * dominanceWeight;
        reasons.push(`Доминация BTC: ${btcDominance.toFixed(2)}% (коэффициент ${dominanceWeight.toFixed(2)})`);
    } catch (error) {
        console.warn('Ошибка получения доминации:', error.message);
    }

    // 3. Маркет мейкер
    if (context.candles && context.candles.length > 20) {
        const sweep = marketMaker.detectLiquiditySweep(context.candles);
        if (sweep && sweep.direction !== 'NONE') {
            reasons.push(`Сбор ликвидности: ${sweep.direction}`);
            weight += 15;
        }
        const bos = marketMaker.detectBOS(context.candles);
        if (bos && bos.type !== 'NONE') {
            reasons.push(`Break of Structure: ${bos.type}`);
            weight += 20;
        }
        const orderBlocks = marketMaker.detectOrderBlock(context.candles);
        if (orderBlocks.length > 0) {
            reasons.push(`Обнаружено ${orderBlocks.length} Order Block`);
            weight += 10;
        }
        const choch = marketMaker.detectCHoCH(context.candles);
        if (choch && choch.type !== 'NONE') {
            reasons.push(`Change of Character (CHoCH) обнаружен`);
            weight += 15;
        }
    }

    return {
        reasons,
        weight: Math.round(weight),
        confidence: weight > 70 ? 'high' : weight > 50 ? 'medium' : 'low'
    };
}

module.exports = { getConfluence };