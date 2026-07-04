// ============================================
//  РИСК-ПАРИТЕТ
// ============================================

class RiskParity {
    constructor(config = {}) {
        this.targetVolatility = config.targetVolatility || 0.1;
        this.maxLeverage = config.maxLeverage || 2;
        this.volatilities = {};
        this.correlations = {};
        this.weights = {};
    }

    /**
     * Рассчитать оптимальные веса для портфеля
     */
    calculateWeights(assets) {
        const n = assets.length;
        const initialWeight = 1 / n;
        const weights = {};
        
        for (const asset of assets) {
            weights[asset] = initialWeight;
        }
        
        // Учитываем волатильность
        for (const asset of assets) {
            const vol = this.volatilities[asset] || 0.02;
            weights[asset] = (1 / vol) / n;
        }
        
        // Нормализация
        const total = Object.values(weights).reduce((a, b) => a + b, 0);
        for (const asset of assets) {
            weights[asset] = weights[asset] / total;
        }
        
        this.weights = weights;
        return weights;
    }

    /**
     * Обновить волатильность актива
     */
    updateVolatility(symbol, returns) {
        if (returns.length < 10) return;
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
        this.volatilities[symbol] = Math.sqrt(variance);
    }

    /**
     * Обновить корреляцию между активами
     */
    updateCorrelation(symbol1, symbol2, returns1, returns2) {
        if (returns1.length < 10 || returns2.length < 10) return;
        const n = Math.min(returns1.length, returns2.length);
        const r1 = returns1.slice(-n);
        const r2 = returns2.slice(-n);
        
        const mean1 = r1.reduce((a, b) => a + b, 0) / n;
        const mean2 = r2.reduce((a, b) => a + b, 0) / n;
        
        let numerator = 0;
        let denom1 = 0;
        let denom2 = 0;
        
        for (let i = 0; i < n; i++) {
            const d1 = r1[i] - mean1;
            const d2 = r2[i] - mean2;
            numerator += d1 * d2;
            denom1 += d1 * d1;
            denom2 += d2 * d2;
        }
        
        if (denom1 > 0 && denom2 > 0) {
            this.correlations[`${symbol1}-${symbol2}`] = numerator / (Math.sqrt(denom1) * Math.sqrt(denom2));
        }
    }

    /**
     * Получить рекомендацию по распределению капитала
     */
    getRecommendation(assets, totalCapital) {
        const weights = this.calculateWeights(assets);
        const recommendations = {};
        
        for (const asset of assets) {
            recommendations[asset] = {
                weight: weights[asset],
                amount: totalCapital * weights[asset],
                volatility: this.volatilities[asset] || 0.02,
                expectedReturn: 0.02 // Примерная доходность
            };
        }
        
        return recommendations;
    }
}

module.exports = { RiskParity };
