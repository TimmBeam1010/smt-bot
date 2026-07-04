// ============================================
//  АРБИТРАЖ МЕЖДУ БИРЖАМИ
// ============================================

const axios = require('axios');

class ArbitrageBot {
    constructor(config = {}) {
        this.exchanges = config.exchanges || ['binance', 'bybit', 'okx', 'bingx'];
        this.minProfitPercent = config.minProfitPercent || 0.5;
        this.maxTradeSize = config.maxTradeSize || 1000;
        this.prices = {};
        this.lastUpdate = 0;
        this.updateInterval = 5000; // 5 секунд
    }

    /**
     * Получить цены со всех бирж
     */
    async getPrices(symbol) {
        try {
            const results = {};
            
            for (const exchange of this.exchanges) {
                try {
                    const price = await this.getPriceFromExchange(exchange, symbol);
                    if (price) {
                        results[exchange] = price;
                    }
                } catch (e) {
                    // Пропускаем биржу, если она не отвечает
                }
            }
            
            this.prices[symbol] = results;
            this.lastUpdate = Date.now();
            return results;
        } catch (error) {
            console.error('Ошибка получения цен:', error.message);
            return this.prices[symbol] || {};
        }
    }

    /**
     * Получить цену с конкретной биржи
     */
    async getPriceFromExchange(exchange, symbol) {
        const urls = {
            binance: `https://api.binance.com/api/v3/ticker/price?symbol=${symbol.replace('-', '')}`,
            bybit: `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol.replace('-', '')}`,
            okx: `https://www.okx.com/api/v5/market/ticker?instId=${symbol.replace('-', '')}`,
            bingx: `https://open-api.bingx.com/openApi/spot/v1/ticker/price?symbol=${symbol.replace('-', '_')}`
        };

        const url = urls[exchange];
        if (!url) return null;

        const response = await axios.get(url, { timeout: 3000 });
        const data = response.data;

        // Парсинг в зависимости от биржи
        if (exchange === 'binance') {
            return parseFloat(data.price);
        } else if (exchange === 'bybit') {
            return parseFloat(data.result.list[0].lastPrice);
        } else if (exchange === 'okx') {
            return parseFloat(data.data[0].last);
        } else if (exchange === 'bingx') {
            if (data.data && data.data.length > 0 && data.data[0].trades) {
                return parseFloat(data.data[0].trades[0].price);
            }
            return parseFloat(data.price);
        }
        
        return null;
    }

    /**
     * Найти арбитражные возможности
     */
    findArbitrageOpportunities(symbol) {
        const prices = this.prices[symbol];
        if (!prices || Object.keys(prices).length < 2) return [];

        const exchanges = Object.keys(prices);
        const opportunities = [];

        for (let i = 0; i < exchanges.length; i++) {
            for (let j = i + 1; j < exchanges.length; j++) {
                const ex1 = exchanges[i];
                const ex2 = exchanges[j];
                const price1 = prices[ex1];
                const price2 = prices[ex2];
                
                if (!price1 || !price2) continue;
                
                const diff = Math.abs(price1 - price2);
                const diffPercent = (diff / Math.min(price1, price2)) * 100;
                
                if (diffPercent > this.minProfitPercent) {
                    const side = price1 < price2 ? 'BUY' : 'SELL';
                    opportunities.push({
                        buyExchange: price1 < price2 ? ex1 : ex2,
                        sellExchange: price1 < price2 ? ex2 : ex1,
                        buyPrice: Math.min(price1, price2),
                        sellPrice: Math.max(price1, price2),
                        diff: diff,
                        diffPercent: diffPercent,
                        profit: (diff / Math.min(price1, price2)) * 100 - 0.1 // минус комиссия
                    });
                }
            }
        }

        return opportunities;
    }

    /**
     * Выполнить арбитражную сделку
     */
    async executeArbitrage(opportunity, symbol, size) {
        if (opportunity.profit < 0) {
            console.log('❌ Арбитраж не выгоден (профит отрицательный)');
            return null;
        }

        console.log(`🚀 Выполняем арбитраж: ${symbol}`);
        console.log(`📊 Покупка на ${opportunity.buyExchange} по ${opportunity.buyPrice}`);
        console.log(`📊 Продажа на ${opportunity.sellExchange} по ${opportunity.sellPrice}`);
        console.log(`📊 Профит: ${opportunity.profit.toFixed(2)}%`);

        // Здесь должна быть логика реального исполнения
        // В текущей версии — только логирование
        return {
            symbol: symbol,
            buyExchange: opportunity.buyExchange,
            sellExchange: opportunity.sellExchange,
            buyPrice: opportunity.buyPrice,
            sellPrice: opportunity.sellPrice,
            profit: opportunity.profit,
            size: size
        };
    }

    /**
     * Запустить арбитражный бот
     */
    start(symbols, interval = 10000) {
        console.log(`🚀 Арбитражный бот запущен для ${symbols.length} символов`);
        console.log(`📊 Интервал: ${interval/1000}с`);
        
        setInterval(async () => {
            for (const symbol of symbols) {
                try {
                    await this.getPrices(symbol);
                    const opportunities = this.findArbitrageOpportunities(symbol);
                    
                    if (opportunities.length > 0) {
                        console.log(`📊 Найдено ${opportunities.length} арбитражных возможностей для ${symbol}`);
                        const best = opportunities.reduce((a, b) => a.profit > b.profit ? a : b);
                        if (best.profit > this.minProfitPercent) {
                            console.log(`💰 Лучшая: ${best.buyExchange} → ${best.sellExchange}, ${best.profit.toFixed(2)}%`);
                        }
                    }
                } catch (error) {
                    console.error(`❌ Ошибка для ${symbol}:`, error.message);
                }
            }
        }, interval);
    }
}

module.exports = { ArbitrageBot };
