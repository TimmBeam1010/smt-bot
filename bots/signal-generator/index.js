#!/usr/bin/env node

const { getExchange } = require("../../shared/exchanges");
const trading = require("../../shared/trading");
const volumeAnalyzer = require("../../shared/volume-analyzer");
const sentimentAnalyzer = require("../../shared/sentiment-analyzer");
const marketMaker = require("../../shared/market-maker");
const aiPredictor = require("../../shared/ai-predictor");
const newsMonitor = require("../../shared/news-monitor");

const log = {
  info: (msg) => console.log(`[${new Date().toISOString()}] [INFO] ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] [WARN] ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] [ERROR] ${msg}`),
  debug: (msg) => console.log(`[${new Date().toISOString()}] [DEBUG] ${msg}`)
};

const CONFIG = {
  symbols: [
    'BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT',
    'ADA-USDT', 'DOGE-USDT', 'DOT-USDT', 'LINK-USDT', 'MATIC-USDT',
    'AVAX-USDT', 'NEAR-USDT', 'ATOM-USDT', 'ALGO-USDT', 'VET-USDT',
    'ICP-USDT', 'FIL-USDT', 'APT-USDT', 'SUI-USDT', 'SEI-USDT',
    'ARB-USDT', 'OP-USDT', 'FTM-USDT', 'EGLD-USDT', 'HBAR-USDT',
    'PEPE-USDT', 'BONK-USDT', 'FLOKI-USDT', 'WIF-USDT', 'BRETT-USDT',
    'MEW-USDT', 'NOT-USDT', 'DOGS-USDT', 'NEIRO-USDT', 'POPCAT-USDT',
    'FET-USDT', 'TAO-USDT', 'RENDER-USDT', 'AKT-USDT', 'OCEAN-USDT',
    'AGIX-USDT', 'AI-USDT', 'WLD-USDT', 'AR-USDT', 'LPT-USDT',
    'UNI-USDT', 'AAVE-USDT', 'MKR-USDT', 'LDO-USDT', 'RUNE-USDT',
    'CRV-USDT', 'FXS-USDT', 'CVX-USDT', 'SNX-USDT', 'PENDLE-USDT',
    'SAND-USDT', 'MANA-USDT', 'GALA-USDT', 'AXS-USDT', 'IMX-USDT',
    'APE-USDT', 'MAGIC-USDT', 'YGG-USDT', 'CHR-USDT', 'ILV-USDT',
    'PYTH-USDT', 'ONDO-USDT', 'ENA-USDT', 'EIGEN-USDT', 'DYDX-USDT',
    'LTC-USDT', 'BCH-USDT', 'ETC-USDT', 'ZEC-USDT', 'XLM-USDT',
    'TRX-USDT', 'XMR-USDT', 'DASH-USDT', 'NEO-USDT', 'WAVES-USDT',
    'JUP-USDT', 'JTO-USDT', 'W-USDT', 'TIA-USDT', 'INJ-USDT',
    'ALT-USDT', 'BOME-USDT', 'MYRO-USDT', 'SLERF-USDT', 'BODEN-USDT'
  ],
  interval: '5m',
  limit: 100,
  checkInterval: 30000,
};

const supabaseUrl = "https://sbpyuigmrqycqlrjlqqv.supabase.co";
const supabaseKey = "sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd";

let exchangeClient = null;
const ai = new aiPredictor.AIPredictor();
const news = new newsMonitor.NewsMonitor();
let sentimentData = null;
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
    return result;
  } catch (error) {
    log.error(`❌ Ошибка сохранения: ${error.message}`);
    return null;
  }
}
async function analyzeAndGenerateSignal(symbol) {
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
  } catch (error) {
    log.error(`❌ Ошибка анализа ${symbol}: ${error.message}`);
  }
}

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
    }
  } catch (error) {
    log.error(`❌ Ошибка: ${error.message}`);
  }
}

async function start() {
  log.info("🚀 Signal Generator Bot запущен (FULL версия)");
  log.info(`📋 Таймфрейм: ${CONFIG.interval}`);
  log.info(`📋 Символы: ${CONFIG.symbols.length}`);
  log.info(`⏱️ Интервал: ${CONFIG.checkInterval / 1000}с`);
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
