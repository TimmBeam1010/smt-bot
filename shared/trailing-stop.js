// ============================================
//  ТРЕЙЛИНГ-СТОП (ПОДВИЖНЫЙ СТОП-ЛОСС)
// ============================================

class TrailingStop {
    constructor(initialPrice, side, trailingPercent = 0.02) {
        this.initialPrice = initialPrice;
        this.side = side;
        this.trailingPercent = trailingPercent;
        this.bestPrice = initialPrice;
        this.triggerPrice = this.calculateTrigger(initialPrice);
        this.isActive = false;
    }

    calculateTrigger(price) {
        if (this.side === 'LONG') {
            return price * (1 - this.trailingPercent);
        } else {
            return price * (1 + this.trailingPercent);
        }
    }

    update(currentPrice) {
        let updated = false;
        
        if (this.side === 'LONG') {
            if (currentPrice > this.bestPrice) {
                this.bestPrice = currentPrice;
                this.triggerPrice = currentPrice * (1 - this.trailingPercent);
                updated = true;
                console.log(`📈 Трейлинг-стоп обновлен: ${this.triggerPrice.toFixed(2)} (лучшая цена: ${this.bestPrice.toFixed(2)})`);
            }
        } else {
            if (currentPrice < this.bestPrice) {
                this.bestPrice = currentPrice;
                this.triggerPrice = currentPrice * (1 + this.trailingPercent);
                updated = true;
                console.log(`📉 Трейлинг-стоп обновлен: ${this.triggerPrice.toFixed(2)} (лучшая цена: ${this.bestPrice.toFixed(2)})`);
            }
        }
        
        const isTriggered = this.side === 'LONG' ? 
            currentPrice <= this.triggerPrice : 
            currentPrice >= this.triggerPrice;
        
        if (isTriggered) {
            console.log(`🔴 Трейлинг-стоп сработал! Цена: ${currentPrice.toFixed(2)}, триггер: ${this.triggerPrice.toFixed(2)}`);
        }
        
        return {
            isTriggered,
            triggerPrice: this.triggerPrice,
            bestPrice: this.bestPrice,
            updated,
            percentFromBest: this.side === 'LONG' ?
                (this.bestPrice - currentPrice) / this.bestPrice * 100 :
                (currentPrice - this.bestPrice) / this.bestPrice * 100
        };
    }

    getStatus() {
        return {
            initialPrice: this.initialPrice,
            bestPrice: this.bestPrice,
            triggerPrice: this.triggerPrice,
            trailingPercent: this.trailingPercent,
            side: this.side
        };
    }
}

module.exports = { TrailingStop };
