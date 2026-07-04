// ============================================
//  КОПИРОВАНИЕ СДЕЛОК (COPY TRADING)
// ============================================

class CopyTrading {
    constructor(config = {}) {
        this.masterAccounts = config.masterAccounts || [];
        this.copyRatio = config.copyRatio || 1.0; // 1:1 копирование
        this.maxPositions = config.maxPositions || 10;
        this.positions = {};
        this.trades = [];
    }

    /**
     * Добавить мастер-аккаунт
     */
    addMasterAccount(name, getTradesFn) {
        this.masterAccounts.push({
            name: name,
            getTrades: getTradesFn,
            lastTrades: []
        });
        console.log(`📊 Мастер-аккаунт "${name}" добавлен`);
    }

    /**
     * Получить сделки со всех мастер-аккаунтов
     */
    async getMasterTrades() {
        const allTrades = [];
        for (const master of this.masterAccounts) {
            try {
                const trades = await master.getTrades();
                if (trades && trades.length > 0) {
                    allTrades.push({
                        master: master.name,
                        trades: trades
                    });
                }
            } catch (error) {
                console.error(`❌ Ошибка получения сделок от "${master.name}":`, error.message);
            }
        }
        return allTrades;
    }

    /**
     * Копировать сделку
     */
    async copyTrade(trade, masterName) {
        const key = `${trade.symbol}-${trade.side}`;
        
        // Проверяем, не скопирована ли уже эта сделка
        if (this.positions[key]) {
            console.log(`⏸️ Сделка ${trade.symbol} ${trade.side} уже скопирована`);
            return null;
        }

        // Проверяем лимит позиций
        if (Object.keys(this.positions).length >= this.maxPositions) {
            console.log(`⏸️ Достигнут лимит позиций (${this.maxPositions})`);
            return null;
        }

        // Копируем сделку
        const copySize = trade.size * this.copyRatio;
        console.log(`📊 Копирование: ${trade.symbol} ${trade.side} (${masterName})`);
        console.log(`📊 Размер: ${copySize} (оригинал: ${trade.size})`);

        this.positions[key] = {
            ...trade,
            copiedAt: new Date().toISOString(),
            master: masterName,
            copySize: copySize,
            originalSize: trade.size
        };

        this.trades.push({
            ...trade,
            master: masterName,
            copiedAt: new Date().toISOString(),
            copySize: copySize
        });

        return this.positions[key];
    }

    /**
     * Закрыть скопированную позицию
     */
    closeCopy(key) {
        if (!this.positions[key]) {
            console.log(`⚠️ Позиция ${key} не найдена`);
            return null;
        }

        const position = this.positions[key];
        console.log(`📊 Закрытие скопированной позиции: ${key}`);
        delete this.positions[key];
        return position;
    }

    /**
     * Синхронизировать с мастер-аккаунтами
     */
    async sync() {
        const masterTrades = await this.getMasterTrades();
        let copied = 0;

        for (const { master, trades } of masterTrades) {
            for (const trade of trades) {
                // Проверяем, есть ли уже такая позиция
                const key = `${trade.symbol}-${trade.side}`;
                if (this.positions[key]) continue;

                // Копируем
                const result = await this.copyTrade(trade, master);
                if (result) copied++;
            }
        }

        console.log(`📊 Синхронизация завершена: скопировано ${copied} сделок`);
        return copied;
    }

    /**
     * Получить статистику
     */
    getStats() {
        const total = this.trades.length;
        const open = Object.keys(this.positions).length;
        const byMaster = {};
        
        for (const trade of this.trades) {
            if (!byMaster[trade.master]) {
                byMaster[trade.master] = 0;
            }
            byMaster[trade.master]++;
        }

        return {
            totalTrades: total,
            openPositions: open,
            byMaster: byMaster,
            copyRatio: this.copyRatio,
            maxPositions: this.maxPositions
        };
    }
}

module.exports = { CopyTrading };
