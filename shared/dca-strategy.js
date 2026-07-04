// ============================================
//  DCA (Dollar Cost Averaging) СТРАТЕГИЯ
// ============================================

class DCAStrategy {
    constructor(config = {}) {
        this.totalAmount = config.totalAmount || 1000; // Общая сумма
        this.parts = config.parts || 5; // Количество частей
        this.interval = config.interval || 60; // Интервал в минутах
        this.currentPart = 0;
        this.entries = [];
        this.isActive = false;
    }

    /**
     * Запустить DCA
     */
    start(symbol, side, initialPrice) {
        this.symbol = symbol;
        this.side = side;
        this.initialPrice = initialPrice;
        this.isActive = true;
        this.currentPart = 0;
        this.entries = [];
        this.partSize = this.totalAmount / this.parts;
        
        // Первая часть
        this.addEntry(initialPrice);
        console.log(`📊 DCA начат для ${symbol}: ${this.parts} частей по ${this.partSize} USDT`);
        return this;
    }

    /**
     * Добавить запись (часть)
     */
    addEntry(price) {
        if (this.currentPart >= this.parts) return false;
        
        this.entries.push({
            price: price,
            amount: this.partSize,
            time: new Date().toISOString()
        });
        this.currentPart++;
        
        console.log(`📊 DCA часть ${this.currentPart}/${this.parts} по цене ${price}`);
        return true;
    }

    /**
     * Проверить, нужно ли добавить следующую часть
     */
    checkAndAdd(currentPrice, dropPercent = 5) {
        if (!this.isActive) return false;
        if (this.currentPart >= this.parts) return false;
        
        const lastPrice = this.entries[this.entries.length - 1].price;
        const change = ((lastPrice - currentPrice) / lastPrice) * 100;
        
        if (this.side === 'LONG' && change > dropPercent) {
            return this.addEntry(currentPrice);
        }
        if (this.side === 'SHORT' && change < -dropPercent) {
            return this.addEntry(currentPrice);
        }
        
        return false;
    }

    /**
     * Получить среднюю цену входа
     */
    getAverageEntryPrice() {
        if (this.entries.length === 0) return 0;
        const totalAmount = this.entries.reduce((sum, e) => sum + e.amount, 0);
        const totalCost = this.entries.reduce((sum, e) => sum + e.amount * e.price, 0);
        return totalCost / totalAmount;
    }

    /**
     * Получить текущий статус
     */
    getStatus(currentPrice) {
        const avgPrice = this.getAverageEntryPrice();
        const totalAmount = this.entries.reduce((sum, e) => sum + e.amount, 0);
        const currentValue = totalAmount * currentPrice / avgPrice;
        const profit = currentValue - totalAmount;
        const profitPercent = (profit / totalAmount) * 100;
        
        return {
            symbol: this.symbol,
            side: this.side,
            entries: this.entries.length,
            totalAmount: totalAmount,
            avgPrice: avgPrice,
            currentPrice: currentPrice,
            currentValue: currentValue,
            profit: profit,
            profitPercent: profitPercent,
            isActive: this.isActive,
            isComplete: this.currentPart >= this.parts
        };
    }

    /**
     * Закрыть DCA
     */
    close() {
        this.isActive = false;
        console.log(`📊 DCA закрыт для ${this.symbol}`);
    }
}

module.exports = { DCAStrategy };
