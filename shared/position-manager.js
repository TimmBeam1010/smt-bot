// ============================================
//  МЕНЕДЖЕР ПОЗИЦИЙ
// ============================================

class PositionManager {
    constructor(config = {}) {
        this.maxLossPercent = config.maxLossPercent || 5; // Максимальный убыток в %
        this.trailingStopPercent = config.trailingStopPercent || 2; // Трейлинг-стоп в %
        this.minProfitPercent = config.minProfitPercent || 0.5; // Минимальная прибыль для активации трейлинга
    }

    /**
     * Проверить позицию на необходимость закрытия
     */
    checkPosition(position, currentPrice) {
        const entryPrice = parseFloat(position.entryPrice || position.entry_price || 0);
        const side = position.side || position.positionSide || 'LONG';
        const unrealizedPL = parseFloat(position.unrealizedProfit || position.unrealized_pl || 0);
        const margin = parseFloat(position.margin || position.initialMargin || 0);
        
        if (!entryPrice || !margin) return { action: 'HOLD', reason: 'Недостаточно данных' };
        
        // Расчет убытка в %
        const lossPercent = margin > 0 ? (unrealizedPL / margin) * 100 : 0;
        
        // Проверка на превышение максимального убытка
        if (lossPercent < -this.maxLossPercent) {
            return { 
                action: 'CLOSE', 
                reason: `Превышен максимальный убыток (${lossPercent.toFixed(2)}%)`,
                emergency: true
            };
        }
        
        // Расчет текущей прибыли для трейлинг-стопа
        const profitPercent = (currentPrice - entryPrice) / entryPrice * 100 * (side === 'LONG' ? 1 : -1);
        
        // Если прибыль превышает минимальную, активируем трейлинг-стоп
        if (profitPercent > this.minProfitPercent) {
            const slPrice = side === 'LONG' 
                ? currentPrice * (1 - this.trailingStopPercent / 100)
                : currentPrice * (1 + this.trailingStopPercent / 100);
            
            return {
                action: 'UPDATE_SL',
                reason: `Трейлинг-стоп (прибыль: ${profitPercent.toFixed(2)}%)`,
                stopLoss: slPrice
            };
        }
        
        return { action: 'HOLD', reason: 'OK' };
    }

    /**
     * Проверить все позиции
     */
    checkAllPositions(positions, currentPrices) {
        const results = [];
        const positionsToClose = [];
        const positionsToUpdate = [];
        
        for (const pos of positions) {
            const symbol = pos.symbol;
            const currentPrice = currentPrices[symbol];
            if (!currentPrice) continue;
            
            const result = this.checkPosition(pos, currentPrice);
            result.symbol = symbol;
            result.position = pos;
            
            if (result.action === 'CLOSE') {
                positionsToClose.push(result);
            } else if (result.action === 'UPDATE_SL') {
                positionsToUpdate.push(result);
            }
            
            results.push(result);
        }
        
        return {
            results,
            toClose: positionsToClose,
            toUpdate: positionsToUpdate
        };
    }
}

module.exports = { PositionManager };
