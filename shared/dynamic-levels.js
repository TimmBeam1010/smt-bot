// ============================================
//  ДИНАМИЧЕСКИЙ РАСЧЁТ TP/SL
//  Использует: ATR + SMC + Volume Profile
// ============================================

const { getSupportResistance } = require('./smart-stop-loss');
const { getVolumeProfile } = require('./volume-analyzer');

/**
 * Расчёт динамических уровней TP/SL
 * @param {string} symbol - Символ
 * @param {number} entryPrice - Цена входа
 * @param {string} side - 'LONG' или 'SHORT'
 * @param {Array} candles - Свечи для анализа
 * @param {number} leverage - Плечо
 * @param {Object} config - Настройки
 * @returns {Object} { stopLoss, takeProfit, method, confidence }
 */
function calculateDynamicTPSL(symbol, entryPrice, side, candles, leverage, config = {}) {
  // Настройки по умолчанию
  const defaults = {
    atrMultiplierSL: 1.5,
    atrMultiplierTP: 2.5,
    useSMC: true,
    useVolume: true,
    minRiskPercent: 0.01,   // Минимальный риск 1%
    maxRiskPercent: 0.05,   // Максимальный риск 5%
    defaultRiskPercent: 0.02,
  };
  
  const cfg = { ...defaults, ...config };
  
  // ============================================
  //  1. РАСЧЁТ ATR
  // ============================================
  const atr = calculateATR(candles, 14);
  const atrValue = atr || entryPrice * cfg.defaultRiskPercent;
  
  // Базовые уровни по ATR
  let slDistance = atrValue * cfg.atrMultiplierSL;
  let tpDistance = atrValue * cfg.atrMultiplierTP;
  
  // ============================================
  //  2. КОРРЕКЦИЯ ПО SMC (Smart Money Concepts)
  // ============================================
  let smcLevels = null;
  let smcConfidence = 0;
  
  if (cfg.useSMC) {
    try {
      const sr = getSupportResistance(candles);
      const fvg = findFairValueGaps(candles);
      const bos = findBreakOfStructure(candles);
      
      smcLevels = { sr, fvg, bos };
      smcConfidence = calculateSMCConfidence(sr, fvg, bos, side);
      
      // Корректируем SL и TP на основе SMC
      if (side === 'LONG') {
        // SL — ближайший уровень поддержки или FVG
        if (sr?.nearestSupport && sr.nearestSupport < entryPrice) {
          const newSL = sr.nearestSupport * 0.998; // чуть ниже уровня
          if (newSL > entryPrice - slDistance) {
            slDistance = entryPrice - newSL;
          }
        }
        // TP — следующий уровень сопротивления или BOS
        if (sr?.nearestResistance && sr.nearestResistance > entryPrice) {
          const newTP = sr.nearestResistance;
          if (newTP < entryPrice + tpDistance) {
            tpDistance = newTP - entryPrice;
          }
        }
      } else {
        // SHORT
        if (sr?.nearestResistance && sr.nearestResistance > entryPrice) {
          const newSL = sr.nearestResistance * 1.002;
          if (newSL < entryPrice + slDistance) {
            slDistance = newSL - entryPrice;
          }
        }
        if (sr?.nearestSupport && sr.nearestSupport < entryPrice) {
          const newTP = sr.nearestSupport;
          if (newTP > entryPrice - tpDistance) {
            tpDistance = entryPrice - newTP;
          }
        }
      }
    } catch (e) {
      // Если SMC не работает — пропускаем
    }
  }
  
  // ============================================
  //  3. КОРРЕКЦИЯ ПО VOLUME PROFILE
  // ============================================
  let volumeConfidence = 0;
  
  if (cfg.useVolume) {
    try {
      const vp = getVolumeProfile(symbol, candles);
      const poc = vp?.poc || 0;
      const hvn = vp?.hvn || [];
      const lvn = vp?.lvn || [];
      
      // Проверяем, есть ли POC рядом с уровнем
      if (poc > 0) {
        const pocDistance = Math.abs(poc - entryPrice) / entryPrice;
        if (pocDistance < 0.02) {
          volumeConfidence = 0.8;
        } else if (pocDistance < 0.05) {
          volumeConfidence = 0.5;
        }
      }
      
      // Корректируем SL на основе HVN/LVN
      if (side === 'LONG') {
        const nearestHVNBelow = hvn.filter(h => h < entryPrice).pop();
        if (nearestHVNBelow && nearestHVNBelow > entryPrice - slDistance) {
          slDistance = entryPrice - nearestHVNBelow;
        }
      } else {
        const nearestHVNAbove = hvn.filter(h => h > entryPrice).shift();
        if (nearestHVNAbove && nearestHVNAbove < entryPrice + slDistance) {
          slDistance = nearestHVNAbove - entryPrice;
        }
      }
    } catch (e) {
      // Если Volume не работает — пропускаем
    }
  }
  
  // ============================================
  //  4. ЗАЩИТА ОТ ЛИКВИДАЦИИ
  // ============================================
  const liqPrice = side === 'LONG' 
    ? entryPrice * (1 - 1/leverage) 
    : entryPrice * (1 + 1/leverage);
  
  let stopLoss, takeProfit;
  
  if (side === 'LONG') {
    stopLoss = entryPrice - slDistance;
    takeProfit = entryPrice + tpDistance;
    
    // Коррекция SL, если он за ликвидацией
    if (stopLoss <= liqPrice) {
      stopLoss = liqPrice * 1.02;
      slDistance = entryPrice - stopLoss;
    }
  } else {
    stopLoss = entryPrice + slDistance;
    takeProfit = entryPrice - tpDistance;
    
    if (stopLoss >= liqPrice) {
      stopLoss = liqPrice * 0.98;
      slDistance = stopLoss - entryPrice;
    }
  }
  
  // ============================================
  //  5. ПРОВЕРКА МИНИМАЛЬНЫХ/МАКСИМАЛЬНЫХ РАССТОЯНИЙ
  // ============================================
  const riskPercent = slDistance / entryPrice;
  if (riskPercent < cfg.minRiskPercent) {
    // Минимальный риск — корректируем
    const newSL = side === 'LONG' 
      ? entryPrice * (1 - cfg.minRiskPercent) 
      : entryPrice * (1 + cfg.minRiskPercent);
    stopLoss = newSL;
  }
  if (riskPercent > cfg.maxRiskPercent) {
    // Максимальный риск — корректируем
    const newSL = side === 'LONG' 
      ? entryPrice * (1 - cfg.maxRiskPercent) 
      : entryPrice * (1 + cfg.maxRiskPercent);
    stopLoss = newSL;
  }
  
  // Пересчитываем расстояния
  slDistance = Math.abs(entryPrice - stopLoss);
  tpDistance = Math.abs(entryPrice - takeProfit);
  
  // ============================================
  //  6. ОПРЕДЕЛЕНИЕ МЕТОДА И УВЕРЕННОСТИ
  // ============================================
  const methods = ['ATR'];
  let confidence = 0.5; // базовая уверенность
  
  if (smcConfidence > 0.5) {
    methods.push('SMC');
    confidence += 0.25;
  }
  if (volumeConfidence > 0.5) {
    methods.push('Volume');
    confidence += 0.25;
  }
  
  // Ограничиваем уверенность
  confidence = Math.min(confidence, 1.0);
  
  // ============================================
  //  7. ОКРУГЛЕНИЕ
  // ============================================
  stopLoss = Math.round(stopLoss * 10000) / 10000;
  takeProfit = Math.round(takeProfit * 10000) / 10000;
  
  return {
    stopLoss,
    takeProfit,
    liqPrice,
    methods: methods.join(' + '),
    confidence: Math.round(confidence * 100),
    slDistance: Math.round(slDistance * 10000) / 10000,
    tpDistance: Math.round(tpDistance * 10000) / 10000,
    riskPercent: Math.round((slDistance / entryPrice) * 10000) / 100,
    rewardPercent: Math.round((tpDistance / entryPrice) * 10000) / 100,
    smcLevels,
    volumeConfidence,
  };
}

// ============================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function calculateATR(candles, period = 14) {
  if (!candles || candles.length < period + 1) return null;
  
  let trSum = 0;
  for (let i = 1; i < period + 1; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i-1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  return trSum / period;
}

function findFairValueGaps(candles) {
  const gaps = [];
  for (let i = 2; i < candles.length; i++) {
    const prevHigh = candles[i-1].high;
    const prevLow = candles[i-1].low;
    const currHigh = candles[i].high;
    const currLow = candles[i].low;
    
    // Бычий FVG
    if (currLow > prevHigh) {
      gaps.push({ type: 'BULLISH', top: currLow, bottom: prevHigh });
    }
    // Медвежий FVG
    if (currHigh < prevLow) {
      gaps.push({ type: 'BEARISH', top: prevLow, bottom: currHigh });
    }
  }
  return gaps;
}

function findBreakOfStructure(candles) {
  if (!candles || candles.length < 5) return null;
  
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  
  // Ищем пробой структуры
  let bos = null;
  const lastHigh = highs[highs.length - 1];
  const prevHigh = highs[highs.length - 3];
  const lastLow = lows[lows.length - 1];
  const prevLow = lows[lows.length - 3];
  
  if (lastHigh > prevHigh) {
    bos = { type: 'BULLISH', level: lastHigh };
  } else if (lastLow < prevLow) {
    bos = { type: 'BEARISH', level: lastLow };
  }
  
  return bos;
}

function calculateSMCConfidence(sr, fvg, bos, side) {
  let score = 0;
  let total = 0;
  
  if (sr) {
    total++;
    if (side === 'LONG' && sr.nearestSupport) score++;
    if (side === 'SHORT' && sr.nearestResistance) score++;
  }
  
  if (fvg && fvg.length > 0) {
    total++;
    score += 0.5;
  }
  
  if (bos) {
    total++;
    if (side === 'LONG' && bos.type === 'BULLISH') score++;
    if (side === 'SHORT' && bos.type === 'BEARISH') score++;
  }
  
  return total > 0 ? score / total : 0;
}

module.exports = { calculateDynamicTPSL };