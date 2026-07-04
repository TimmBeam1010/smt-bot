// ============================================
//  АНАЛИЗ ОБЪЕМОВ (VOLUME PROFILE)
// ============================================

/**
 * Найти уровни с высоким объемом (High Volume Nodes - HVN)
 */
function findHighVolumeNodes(candles, multiplier = 2) {
    if (!candles || candles.length < 10) return [];
    
    const volumes = candles.map(c => c.volume || 0);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const threshold = avgVolume * multiplier;
    
    const nodes = [];
    candles.forEach((candle, index) => {
        if (candle.volume > threshold) {
            nodes.push({
                price: candle.close,
                volume: candle.volume,
                index: index,
                timestamp: candle.timestamp || index
            });
        }
    });
    
    return nodes;
}

/**
 * Найти уровни с низким объемом (Low Volume Nodes - LVN)
 */
function findLowVolumeNodes(candles, multiplier = 0.5) {
    if (!candles || candles.length < 10) return [];
    
    const volumes = candles.map(c => c.volume || 0);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const threshold = avgVolume * multiplier;
    
    const nodes = [];
    candles.forEach((candle, index) => {
        if (candle.volume < threshold && candle.volume > 0) {
            nodes.push({
                price: candle.close,
                volume: candle.volume,
                index: index,
                timestamp: candle.timestamp || index
            });
        }
    });
    
    return nodes;
}

/**
 * Построить Volume Profile для диапазона
 */
function buildVolumeProfile(candles, levels = 20) {
    if (!candles || candles.length < 10) return null;
    
    const prices = candles.map(c => c.close);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const step = (maxPrice - minPrice) / levels;
    
    const profile = [];
    for (let i = 0; i < levels; i++) {
        const low = minPrice + i * step;
        const high = minPrice + (i + 1) * step;
        let volume = 0;
        let count = 0;
        
        candles.forEach(candle => {
            if (candle.close >= low && candle.close < high) {
                volume += candle.volume || 0;
                count++;
            }
        });
        
        if (count > 0) {
            profile.push({
                level: (low + high) / 2,
                volume: volume,
                count: count,
                low: low,
                high: high
            });
        }
    }
    
    // Сортируем по объему
    profile.sort((a, b) => b.volume - a.volume);
    
    return {
        levels: profile,
        poc: profile[0] || null, // Point of Control (самый высокий объем)
        totalVolume: profile.reduce((a, b) => a + b.volume, 0)
    };
}

/**
 * Найти уровни поддержки/сопротивления по объемам
 */
function findVolumeLevels(candles) {
    const profile = buildVolumeProfile(candles);
    if (!profile) return { support: null, resistance: null };
    
    // POC - точка с самым высоким объемом
    const poc = profile.poc;
    if (!poc) return { support: null, resistance: null };
    
    // Ищем поддержку и сопротивление (ближайшие уровни с объемом ниже)
    const sortedByLevel = [...profile.levels].sort((a, b) => a.level - b.level);
    const pocIndex = sortedByLevel.findIndex(l => l.level === poc.level);
    
    let support = null;
    let resistance = null;
    
    // Ищем ближайший уровень ниже POC
    for (let i = pocIndex - 1; i >= 0; i--) {
        if (sortedByLevel[i].volume < poc.volume * 0.3) {
            support = sortedByLevel[i].level;
            break;
        }
    }
    
    // Ищем ближайший уровень выше POC
    for (let i = pocIndex + 1; i < sortedByLevel.length; i++) {
        if (sortedByLevel[i].volume < poc.volume * 0.3) {
            resistance = sortedByLevel[i].level;
            break;
        }
    }
    
    return { support, resistance, poc: poc.level };
}

/**
 * Проверить, находится ли цена в зоне высокого объема
 */
function isInHighVolumeZone(price, candles, threshold = 0.02) {
    const profile = buildVolumeProfile(candles);
    if (!profile) return false;
    
    const totalVolume = profile.totalVolume;
    let zoneVolume = 0;
    
    profile.levels.forEach(level => {
        if (Math.abs(level.level - price) / price < threshold) {
            zoneVolume += level.volume;
        }
    });
    
    return (zoneVolume / totalVolume) > 0.1; // 10% объема в зоне
}

/**
 * Получить объемный вес сигнала
 */
function getVolumeWeight(symbol, entryPrice, candles) {
    const profile = buildVolumeProfile(candles);
    if (!profile) return { weight: 1, poc: null, inHighVolume: false };
    
    const inHighVolume = isInHighVolumeZone(entryPrice, candles);
    const distanceToPoc = profile.poc ? Math.abs(entryPrice - profile.poc.level) / entryPrice : 1;
    
    // Чем ближе к POC, тем выше вес
    let weight = 1;
    if (profile.poc) {
        weight = 1 - Math.min(distanceToPoc * 2, 0.8);
        weight = Math.max(weight, 0.2);
    }
    
    return {
        weight: weight,
        poc: profile.poc,
        inHighVolume: inHighVolume,
        support: profile.support || null,
        resistance: profile.resistance || null
    };
}

module.exports = {
    findHighVolumeNodes,
    findLowVolumeNodes,
    buildVolumeProfile,
    findVolumeLevels,
    isInHighVolumeZone,
    getVolumeWeight
};
