// ============================================
//  МОНИТОРИНГ ЛИКВИДНОСТИ
// ============================================

class LiquidityMonitor {
    constructor(config = {}) {
        this.minLiquidity = config.minLiquidity || 100000; // Минимальная ликвидность в USDT
        this.maxSpread = config.maxSpread || 0.01; // Максимальный спред
        this.liquidityData = {};
        this.lastUpdate = 0;
    }

    /**
     * Обновить данные о ликвидности
     */
    updateLiquidity(symbol, bid, ask, volume, depth) {
        const spread = (ask - bid) / bid;
        const liquidity = bid * depth;
        
        this.liquidityData[symbol] = {
            bid: bid,
            ask: ask,
            spread: spread,
            volume: volume,
            depth: depth,
            liquidity: liquidity,
            updatedAt: new Date().toISOString(),
            isHealthy: liquidity > this.minLiquidity && spread < this.maxSpread
        };
        
        this.lastUpdate = Date.now();
    }

    /**
     * Проверить, достаточно ли ликвидности для входа
     */
    canEnter(symbol, size) {
        const data = this.liquidityData[symbol];
        if (!data) return { allowed: false, reason: 'Нет данных о ликвидности' };
        
        if (!data.isHealthy) {
            return { 
                allowed: false, 
                reason: `Недостаточная ликвидность: ${data.liquidity} USDT (мин: ${this.minLiquidity})` 
            };
        }
        
        const maxSize = data.liquidity * 0.01; // Максимум 1% от ликвидности
        if (size > maxSize) {
            return { 
                allowed: false, 
                reason: `Размер ${size} превышает допустимый ${maxSize} (1% от ликвидности)` 
            };
        }
        
        return { allowed: true, maxSize: maxSize };
    }

    /**
     * Получить рекомендацию по размеру позиции
     */
    getRecommendedSize(symbol, baseSize) {
        const data = this.liquidityData[symbol];
        if (!data) return baseSize;
        
        const maxSize = data.liquidity * 0.01;
        return Math.min(baseSize, maxSize);
    }
}

module.exports = { LiquidityMonitor };
