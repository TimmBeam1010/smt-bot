// ============================================
//  ДИНАМИЧЕСКИЙ РИСК-МЕНЕДЖМЕНТ
// ============================================

/**
 * Рассчитать динамический риск на основе волатильности
 */
function calculateDynamicRisk(symbol, volatility, balance) {
    // Базовая настройка
    let baseRisk = 0.3; // 0.3% от депозита
    
    // Если волатильность высокая — уменьшаем риск
    if (volatility > 0.05) {
        return 0.2; // 0.2% для волатильных пар
    }
    
    // Если волатильность низкая — увеличиваем риск
    if (volatility < 0.02) {
        return 0.4; // 0.4% для спокойных пар
    }
    
    // Если баланс маленький — уменьшаем риск
    if (balance < 50) {
        return 0.15;
    }
    
    return baseRisk;
}

/**
 * Рассчитать адаптивное плечо
 */
function calculateDynamicLeverage(symbol, volatility, balance) {
    // Базовая настройка
    let baseLeverage = 10;
    
    // Волатильные пары — меньше плечо
    if (volatility > 0.05) {
        return 5; // 5x для волатильных
    }
    
    // Спокойные пары — больше плечо
    if (volatility < 0.02) {
        return 15; // 15x для спокойных
    }
    
    // Маленький баланс — меньше плечо
    if (balance < 50) {
        return 5;
    }
    
    return baseLeverage;
}

/**
 * Рассчитать волатильность из свечей
 */
function calculateVolatility(candles) {
    if (!candles || candles.length < 20) return 0.03;
    
    const closes = candles.map(c => c.close);
    const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
    const variance = closes.reduce((a, c) => a + Math.pow(c - avg, 2), 0) / closes.length;
    const std = Math.sqrt(variance);
    
    return std / avg; // Относительная волатильность
}

module.exports = {
    calculateDynamicRisk,
    calculateDynamicLeverage,
    calculateVolatility
};
