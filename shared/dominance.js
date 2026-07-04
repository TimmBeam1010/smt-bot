// ============================================
//  МОДУЛЬ ДОМИНАЦИИ
// ============================================

const axios = require('axios');
const cache = require('./cache');

const CACHE_TTL = 300000; // 5 минут
const API_URL = 'https://api.coingecko.com/api/v3/global';

async function getDominanceData() {
    const cacheKey = 'dominance_data';
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
        const response = await axios.get(API_URL);
        const data = response.data.data;
        const result = {
            btc: data.market_cap_percentage.btc || 0,
            eth: data.market_cap_percentage.eth || 0,
            stablecoins: data.market_cap_percentage.stablecoins || 0,
            updatedAt: new Date().toISOString()
        };
        cache.set(cacheKey, result, CACHE_TTL);
        return result;
    } catch (error) {
        console.error('Ошибка получения доминации:', error.message);
        return null;
    }
}

async function getBtcDominance() {
    const data = await getDominanceData();
    return data ? data.btc : 0;
}

function adjustSignalByDominance(signal, dominance) {
    let weight = 1;
    if (dominance > 55) {
        if (signal.side === 'LONG' && signal.symbol !== 'BTC-USDT') {
            weight = 0.8;
        } else if (signal.side === 'SHORT' && signal.symbol !== 'BTC-USDT') {
            weight = 1.2;
        }
    }
    if (dominance < 45) {
        if (signal.side === 'LONG' && signal.symbol !== 'BTC-USDT') {
            weight = 1.2;
        } else if (signal.side === 'SHORT' && signal.symbol !== 'BTC-USDT') {
            weight = 0.8;
        }
    }
    return weight;
}

module.exports = {
    getDominanceData,
    getBtcDominance,
    adjustSignalByDominance
};