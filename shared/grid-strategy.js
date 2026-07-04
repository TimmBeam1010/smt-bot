// ============================================
//  ГРИД-СТРАТЕГИЯ
// ============================================

class GridStrategy {
    constructor(config = {}) {
        this.levels = config.levels || 10;
        this.gridSize = config.gridSize || 1; // %
        this.orderType = config.orderType || 'LIMIT';
        this.orders = [];
    }

    /**
     * Создать сетку ордеров
     */
    createGrid(currentPrice, side) {
        const grid = [];
        const basePrice = currentPrice;
        
        if (side === 'LONG') {
            // Buy grid (от текущей цены вниз)
            for (let i = 1; i <= this.levels; i++) {
                const price = basePrice * (1 - (i * this.gridSize) / 100);
                grid.push({
                    price: price,
                    side: 'BUY',
                    size: 1 / this.levels
                });
            }
            // Sell grid (от текущей цены вверх)
            for (let i = 1; i <= this.levels; i++) {
                const price = basePrice * (1 + (i * this.gridSize) / 100);
                grid.push({
                    price: price,
                    side: 'SELL',
                    size: 1 / this.levels
                });
            }
        } else {
            // SHORT grid (от текущей цены вверх)
            for (let i = 1; i <= this.levels; i++) {
                const price = basePrice * (1 + (i * this.gridSize) / 100);
                grid.push({
                    price: price,
                    side: 'SELL',
                    size: 1 / this.levels
                });
            }
            // Buy grid (от текущей цены вниз)
            for (let i = 1; i <= this.levels; i++) {
                const price = basePrice * (1 - (i * this.gridSize) / 100);
                grid.push({
                    price: price,
                    side: 'BUY',
                    size: 1 / this.levels
                });
            }
        }
        
        this.orders = grid;
        return grid;
    }

    /**
     * Проверить, какие ордера сработали
     */
    checkOrders(currentPrice) {
        const executed = [];
        const remaining = [];
        
        for (const order of this.orders) {
            if (order.side === 'BUY' && currentPrice <= order.price) {
                executed.push(order);
            } else if (order.side === 'SELL' && currentPrice >= order.price) {
                executed.push(order);
            } else {
                remaining.push(order);
            }
        }
        
        this.orders = remaining;
        return executed;
    }

    /**
     * Перебалансировать сетку
     */
    rebalance(currentPrice) {
        const totalSize = this.orders.reduce((sum, order) => sum + order.size, 0);
        const newGrid = this.createGrid(currentPrice, 'LONG');
        this.orders = newGrid;
        return this.orders;
    }
}

module.exports = { GridStrategy };
