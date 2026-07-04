// ============================================
//  ИНТЕГРАЦИЯ С DEX
// ============================================

class DEXIntegration {
    constructor(config = {}) {
        this.dexes = config.dexes || ['uniswap', 'pancakeswap'];
        this.prices = {};
        this.lastUpdate = 0;
    }

    /**
     * Получить цену с DEX
     */
    async getPrice(symbol) {
        // Симуляция получения цены с DEX
        // В реальности здесь был бы запрос к API DEX
        const basePrice = 50000;
        const randomFactor = 0.95 + Math.random() * 0.1;
        return basePrice * randomFactor;
    }

    /**
     * Найти арбитраж между CEX и DEX
     */
    findArbitrage(cexPrice, dexPrice) {
        const diff = Math.abs(cexPrice - dexPrice);
        const diffPercent = (diff / Math.min(cexPrice, dexPrice)) * 100;
        
        if (diffPercent > 0.5) {
            return {
                opportunity: true,
                action: cexPrice < dexPrice ? 'BUY_CEX_SELL_DEX' : 'BUY_DEX_SELL_CEX',
                diffPercent: diffPercent
            };
        }
        
        return { opportunity: false };
    }
}

module.exports = { DEXIntegration };
