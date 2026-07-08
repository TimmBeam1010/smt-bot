#!/usr/bin/env node

const { getExchange } = require("../../shared/exchanges");
const trading = require("../../shared/trading");
const volumeAnalyzer = require("../../shared/volume-analyzer");
const sentimentAnalyzer = require("../../shared/sentiment-analyzer");
const marketMaker = require("../../shared/market-maker");
const aiPredictor = require("../../shared/ai-predictor");
const newsMonitor = require("../../shared/news-monitor");
const notifier = require('../../shared/notifier');

// ============================================
//  ЛОГГЕР
// ============================================
const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

// ============================================
//  КОНФИГУРАЦИЯ (С УВЕЛИЧЕННЫМИ ИНТЕРВАЛАМИ)
// ============================================
const CONFIG = {
  symbols: [
    'BTC-USDT', 'ETH-USDT', 'LINK-USDT', 'BCH-USDT', 'ADA-USDT',
    'XRP-USDT', 'LTC-USDT', 'DOT-USDT', 'AVAX-USDT', 'THETA-USDT',
    'ALGO-USDT', 'AXS-USDT', 'DYDX-USDT', 'ICP-USDT', 'SAND-USDT',
    'KSM-USDT', 'VET-USDT', 'SUSHI-USDT', 'SOL-USDT', 'NEAR-USDT',
    'ATOM-USDT', 'BSV-USDT', 'UNI-USDT', 'FIL-USDT', 'AAVE-USDT',
    'DOGE-USDT', 'ENJ-USDT', 'MANA-USDT', 'CHZ-USDT', 'TRX-USDT',
    'SKL-USDT', 'ZRX-USDT', 'SNX-USDT', 'CRV-USDT', 'YFI-USDT',
    '1INCH-USDT', 'COMP-USDT', 'GRT-USDT', 'MASK-USDT', 'AR-USDT',
    'ENS-USDT', 'BAT-USDT', 'STORJ-USDT', 'IMX-USDT', 'XLM-USDT',
    'ZEC-USDT', 'DASH-USDT', 'XMR-USDT', 'WAVES-USDT', 'ONT-USDT',
    'ONE-USDT', 'EGLD-USDT', 'HBAR-USDT', 'CELO-USDT', 'KAVA-USDT',
    'BNB-USDT', 'GALA-USDT', 'YGG-USDT', 'ALICE-USDT', 'CHR-USDT',
    'APE-USDT', 'RSR-USDT', 'KNC-USDT', 'FLOW-USDT', 'GMT-USDT',
    'RUNE-USDT', 'RVN-USDT', 'NEO-USDT', 'IOST-USDT', 'ETC-USDT',
    'ROSE-USDT', 'MINA-USDT', 'CFX-USDT', 'API3-USDT', 'AGLD-USDT',
    'SLP-USDT', 'JASMY-USDT', 'CTK-USDT', 'MTL-USDT', 'PEOPLE-USDT',
    'ANKR-USDT', 'WOO-USDT', 'CRO-USDT', 'LUNC-USDT', 'LUNA-USDT',
    'OP-USDT', 'LDO-USDT', 'STG-USDT', 'INJ-USDT', 'APT-USDT',
    'QNT-USDT', 'ARPA-USDT', 'SFP-USDT', 'MAGIC-USDT', 'FET-USDT',
    'GMX-USDT', 'COTI-USDT', 'METIS-USDT', 'ASTR-USDT', 'DUSK-USDT',
    'BLUR-USDT', 'STX-USDT', 'ACH-USDT', 'TRB-USDT', 'FLOKI-USDT',
    'ILV-USDT', 'ZEN-USDT', 'SCRT-USDT', 'RLC-USDT', 'LPT-USDT',
    'CKB-USDT', 'QTUM-USDT', 'SUN-USDT', 'IOTA-USDT', 'SSV-USDT',
    'BICO-USDT', 'TLM-USDT', 'XCN-USDT', 'TWT-USDT', 'LQTY-USDT',
    'ID-USDT', 'ARB-USDT', 'EDU-USDT', 'SUI-USDT', 'TURBO-USDT',
    'ORDI-USDT', 'UMA-USDT', 'OKB-USDT', 'NMR-USDT', 'MAV-USDT',
    'WLD-USDT', 'PENDLE-USDT', 'ARKM-USDT', 'CYBER-USDT', 'SEI-USDT',
    '1000PEPE-USDT', 'ARK-USDT', 'KAS-USDT', 'BIGTIME-USDT',
    'RIF-USDT', 'POLYX-USDT', 'GAS-USDT'
  ],
  interval: '5m',
  limit: 100,
  checkInterval: 120000,          // 🔥 120 секунд (было 30)
  requestDelay: 500,              // 🔥 500 мс между запросами (было 300)
  maxRetries: 3,                  // 🔥 Максимум повторных попыток
  retryDelay: 10000,              // 🔥 10 секунд между повторами
};

const supabaseUrl = "https://sbpyuigmrqycqlrjlqqv.supabase.co";
const supabaseKey = "sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd";

let exchangeClient = null;
const ai = new aiPredictor.AIPredictor();
const news = new newsMonitor.NewsMonitor();
let sentimentData = null;

// ============================================
//  SUPABASE
// ============================================
async function supabaseRequest(method, endpoint, data = null) {
  const url = `${supabaseUrl}/rest/v1/${endpoint}`;
  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };
  const options = { method, headers };
  if (data) options.body = JSON.stringify(data);
  const response = await fetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return response.json();
}

// ============================================
//  TP/SL
// ============================================
function calculateTPSL(entryPrice, side, atr) {
  const atrValue = atr || entryPrice * 0.02;
  const slDistance = atrValue * 1.5;
  const tpDistance = atrValue * 2.5;

  if (side === "LONG") {
    return {
      stop_loss: Math.round((entryPrice - slDistance) * 10000) / 10000,
      take_profit: Math.round((entryPrice + tpDistance) * 10000) / 10000
    };
  } else {
    return {
      stop_loss: Math.round((entryPrice + slDistance) * 10000) / 10000,
      take_profit: Math.round((entryPrice - tpDistance) * 10000) / 10000
    };
  }
}

// ============================================
//  АНАЛИЗ С МОДУЛЯМИ
// ============================================
async function analyzeWithModules(symbol, candles, prices, highs, lows, volumes) {
  const lastPrice = prices[prices.length - 1];
  const modulesResult = {
    volume: null,
    sentiment: null,
    marketMaker: null,
    ai: null,
    news: null
  };

  try {
    const volData = volumeAnalyzer.getVolumeWeight(symbol, lastPrice, candles);
    modulesResult.volume = volData;
  } catch(e) { log.debug(`Volume ошибка: ${e.message}`); }

  try {
    if (!sentimentData) {
      const sent = new sentimentAnalyzer.SentimentAnalyzer();
      sentimentData = await sent.refreshAll();
    }
    modulesResult.sentiment = sentimentData;
  } catch(e) { log.debug(`Sentiment ошибка: ${e.message}`); }

  try {
    const detector = new marketMaker.MarketMakerDetector();
    const detection = detector.detect(candles);
    modulesResult.marketMaker = detection;
  } catch(e) { log.debug(`Market Maker ошибка: ${e.message}`); }

  try {
    const marketData = {
      volume: volumes[volumes.length - 1] || 0,
      avgVolume: volumes.reduce((a,b) => a + b, 0) / volumes.length,
      trend: prices[prices.length - 1] > prices[prices.length - 10] ? 'BULLISH' : 'BEARISH',
      priceChange: ((prices[prices.length - 1] - prices[prices.length - 10]) / prices[prices.length - 10]) * 100
    };
    const baseSignal = { rsi: 50, macd: 0 };
    const prediction = ai.predict(baseSignal, marketData);
    modulesResult.ai = prediction;
  } catch(e) { log.debug(`AI ошибка: ${e.message}`); }

  try {
    if (news.news.length === 0) {
      await news.fetchNews();
    }
    const newsAnalysis = news.analyzeNews(symbol);
    modulesResult.news = newsAnalysis;
  } catch(e) { log.debug(`News ошибка: ${e.message}`); }

  return modulesResult;
}

// ============================================
//  СОХРАНЕНИЕ СИГНАЛА
// ============================================
async function saveSignalDirectly(signal, modules) {
  try {
    if (!signal) return null;
    if (signal.confidence === "low") {
      log.warn(`⛔ БЛОКИРОВКА LOW: ${signal.symbol} ${signal.side}`);
      return null;
    }
    if (signal.confidence !== "medium" && signal.confidence !== "high") {
      log.warn(`⛔ БЛОКИРОВКА НЕИЗВЕСТНЫЙ: ${signal.symbol} ${signal.side} (${signal.confidence})`);
      return null;
    }

    const atr = signal.atr || signal.entry * 0.02;
    const levels = calculateTPSL(signal.entry, signal.side, atr);

    let enhancedConfidence = signal.confidence;
    let additionalReasons = [];

    if (modules?.volume?.weight > 0.8) {
      enhancedConfidence = 'high';
      additionalReasons.push('Подтверждено Volume Profile');
    }
    if (modules?.sentiment?.fearAndGreed < 30 && signal.side === 'LONG') {
      enhancedConfidence = 'high';
      additionalReasons.push('Fear & Greed: страх');
    }
    if (modules?.sentiment?.fearAndGreed > 70 && signal.side === 'SHORT') {
      enhancedConfidence = 'high';
      additionalReasons.push('Fear & Greed: жадность');
    }
    if (modules?.marketMaker?.isActive) {
      additionalReasons.push('Обнаружена активность маркет мейкера');
    }
    if (modules?.ai?.confidence > 0.7) {
      additionalReasons.push(`AI предсказание: ${modules.ai.direction}`);
    }
    if (modules?.news?.isImportant) {
      additionalReasons.push(modules.news.isPositive ? 'Позитивные новости' : 'Негативные новости');
    }

    const signalData = {
      user_id: 11,
      symbol: signal.symbol,
      side: signal.side,
      entry_price: Math.round(signal.entry * 10000) / 10000,
      confidence: enhancedConfidence,
      status: "pending",
      reasons: [...signal.reasons, ...additionalReasons],
      rsi: signal.rsi || null,
      macd: signal.macd || null,
      stop_loss: levels.stop_loss,
      take_profit: levels.take_profit,
      created_at: new Date().toISOString()
    };

    log.info(`💾 СОХРАНЕНИЕ: ${signal.symbol} ${signal.side} | TP: ${levels.take_profit} | SL: ${levels.stop_loss} | ATR: ${atr} | Уверенность: ${enhancedConfidence}`);

    const result = await supabaseRequest("POST", "signals", signalData);
    log.info(`✅ СОХРАНЕН! ID: ${result?.[0]?.id || "OK"}`);
    
    // Отправка в Telegram
    try {
      await notifier.notifySignal(signalData);
      log.info(`📨 Telegram: сигнал отправлен для ${signal.symbol}`);
    } catch (e) {
      log.debug(`Telegram ошибка: ${e.message}`);
    }
    
    return result;
  } catch (error) {
    log.error(`❌ Ошибка сохранения: ${error.message}`);
    return null;
  }
}

// ============================================
//  🔥 АНАЛИЗ СИГНАЛА (С ПОВТОРАМИ И ЗАДЕРЖКОЙ)
// ============================================
async function analyzeAndGenerateSignal(symbol) {
  let retries = 0;
  while (retries < CONFIG.maxRetries) {
    try {
      if (!exchangeClient) return;
      
      const candles = await exchangeClient.getCandles(symbol, CONFIG.interval, CONFIG.limit);
      if (!candles || candles.length < 30) {
        log.debug(`❌ Недостаточно свечей для ${symbol}`);
        return;
      }
      
      const prices = candles.map(c => c.close);
      const highs = candles.map(c => c.high);
      const lows = candles.map(c => c.low);
      const volumes = candles.map(c => c.volume);

      const signal = trading.generateSignal(symbol, prices, { highs, lows, volumes });
      if (!signal) {
        log.debug(`❌ Нет сигнала для ${symbol}`);
        return;
      }

      const modules = await analyzeWithModules(symbol, candles, prices, highs, lows, volumes);
      log.debug(`📊 Сгенерирован сигнал: ${symbol} ${signal.side} (${signal.confidence})`);

      await saveSignalDirectly(signal, modules);
      return; // Успешно завершили

    } catch (error) {
      retries++;
      if (error.message?.includes('502') || error.message?.includes('429') || error.message?.includes('109500')) {
        log.warn(`⚠️ Ошибка API (${retries}/${CONFIG.maxRetries}) для ${symbol}: ${error.message}`);
        if (retries < CONFIG.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
          continue;
        }
      }
      log.error(`❌ Ошибка анализа ${symbol}: ${error.message}`);
      return;
    }
  }
}

// ============================================
//  🔥 ГЛАВНЫЙ ЦИКЛ (С УВЕЛИЧЕННОЙ ЗАДЕРЖКОЙ)
// ============================================
async function mainLoop() {
  try {
    if (!exchangeClient) {
      log.info("🔧 Инициализация клиента...");
      exchangeClient = getExchange("bingx",
        process.env.BINGX_API_KEY || "BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A",
        process.env.BINGX_SECRET_KEY || "jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA"
      );
      log.info("✅ Клиент инициализирован");
    }
    log.info(`📊 Анализ ${CONFIG.symbols.length} символов...`);
    
    for (const symbol of CONFIG.symbols) {
      await analyzeAndGenerateSignal(symbol);
      // 🔥 ЗАДЕРЖКА МЕЖДУ ЗАПРОСАМИ (500 мс)
      await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelay));
    }
    
    log.info(`✅ Цикл завершен. Следующий через ${CONFIG.checkInterval / 1000}с`);
  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  }
}

// ============================================
//  ЗАПУСК
// ============================================
async function start() {
  log.info("🚀 Signal Generator Bot запущен (FULL версия)");
  log.info(`📋 Таймфрейм: ${CONFIG.interval}`);
  log.info(`📋 Символы: ${CONFIG.symbols.length}`);
  log.info(`⏱️ Интервал: ${CONFIG.checkInterval / 1000}с (увеличен для снижения нагрузки)`);
  log.info(`⏱️ Задержка между запросами: ${CONFIG.requestDelay}мс`);
  log.info(`🔄 Повторы: ${CONFIG.maxRetries} раз`);
  log.info("🧠 Модули: Volume Profile, Sentiment, AI, Market Maker, News");
  await mainLoop();
  setInterval(mainLoop, CONFIG.checkInterval);
}

if (require.main === module) {
  start().catch(error => {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { start, analyzeAndGenerateSignal };