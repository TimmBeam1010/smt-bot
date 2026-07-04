// ============================================
//  МУЛЬТИ-ВАЛЮТНЫЙ ПОРТФЕЛЬ
// ============================================

class PortfolioManager {
    constructor(config = {}) {
        this.portfolio = {};
        this.allocations = config.allocations || {};
        this.totalValue = 0;
        this.history = [];
    }

    /**
     * Добавить актив в портфель
     */
    addAsset(symbol, amount, price) {
        const value = amount * price;
        this.portfolio[symbol] = {
            amount: amount,
            price: price,
            value: value,
            allocation: 0
        };
        this.updateAllocations();
        console.log(`📊 Добавлен актив: ${symbol} (${amount})`);
        return this.portfolio[symbol];
    }

    /**
     * Обновить цены активов
     */
    updatePrices(prices) {
        for (const [symbol, price] of Object.entries(prices)) {
            if (this.portfolio[symbol]) {
                this.portfolio[symbol].price = price;
                this.portfolio[symbol].value = this.portfolio[symbol].amount * price;
            }
        }
        this.updateAllocations();
        this.recordHistory();
    }

    /**
     * Обновить аллокации
     */
    updateAllocations() {
        this.totalValue = Object.values(this.portfolio).reduce((sum, asset) => sum + asset.value, 0);
        
        for (const [symbol, asset] of Object.entries(this.portfolio)) {
            asset.allocation = this.totalValue > 0 ? (asset.value / this.totalValue) * 100 : 0;
        }
    }

    /**
     * Записать историю
     */
    recordHistory() {
        const record = {
            timestamp: new Date().toISOString(),
            totalValue: this.totalValue,
            assets: { ...this.portfolio }
        };
        this.history.push(record);
        if (this.history.length > 1000) {
            this.history.shift();
        }
    }

    /**
     * Ребалансировать портфель
     */
    rebalance(targetAllocations) {
        if (!targetAllocations) {
            // Равномерное распределение
            const symbols = Object.keys(this.portfolio);
            const equalAlloc = 100 / symbols.length;
            targetAllocations = {};
            symbols.forEach(s => targetAllocations[s] = equalAlloc);
        }
        
        const changes = [];
        for (const [symbol, target] of Object.entries(targetAllocations)) {
            if (this.portfolio[symbol]) {
                const current = this.portfolio[symbol].allocation;
                const diff = target - current;
                if (Math.abs(diff) > 1) {
                    changes.push({
                        symbol: symbol,
                        current: current,
                        target: target,
                        diff: diff
                    });
                }
            }
        }
        
        console.log(`📊 Ребалансировка: ${changes.length} изменений`);
        return changes;
    }

    /**
     * Получить статистику портфеля
     */
    getStats() {
        const returns = [];
        if (this.history.length > 1) {
            for (let i = 1; i < this.history.length; i++) {
                const prev = this.history[i-1].totalValue;
                const curr = this.history[i].totalValue;
                returns.push((curr - prev) / prev);
            }
        }
        
        const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
        const stdDev = returns.length > 0 ? 
            Math.sqrt(returns.reduce((a, b) => a + Math.pow(b - avgReturn, 2), 0) / returns.length) : 0;
        
        return {
            totalValue: this.totalValue,
            assets: Object.keys(this.portfolio).length,
            allocations: Object.fromEntries(
                Object.entries(this.portfolio).map(([s, a]) => [s, a.allocation])
            ),
            avgReturn: avgReturn * 100,
            volatility: stdDev * 100,
            sharpeRatio: stdDev > 0 ? avgReturn / stdDev : 0
        };
    }
}

module.exports = { PortfolioManager };
