#!/usr/bin/env node

// ============================================
//  SMT BOT API SERVER v3.0
//  Модульный REST API для торгового бота
// ============================================

const express = require('express');
const cors = require('cors');
const { getExchange } = require('../shared/exchanges');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// ============================================
//  ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// ============================================
let exchangeClient = null;

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
//  ИНИЦИАЛИЗАЦИЯ КЛИЕНТА БИРЖИ
// ============================================
async function initExchangeClient() {
  try {
    // Используем API ключи из переменных окружения или запасные
    const apiKey = process.env.BINGX_API_KEY || "BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A";
    const secretKey = process.env.BINGX_SECRET_KEY || "jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA";
    
    exchangeClient = getExchange("bingx", apiKey, secretKey);
    log.info('✅ API: Exchange client initialized');
    return true;
  } catch (error) {
    log.error(`❌ API: Failed to initialize exchange client: ${error.message}`);
    return false;
  }
}

// ============================================
//  API ENDPOINTS
// ============================================

// -------------------- СТАТУС --------------------
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    version: '3.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// -------------------- БАЛАНС --------------------
app.get('/api/balance', async (req, res) => {
  try {
    if (!exchangeClient) {
      return res.status(503).json({ error: 'Exchange client not initialized' });
    }
    
    const balance = await exchangeClient.getBalance();
    res.json({
      balance: parseFloat(balance) || 0,
      currency: 'USDT',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log.error(`Error fetching balance: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// -------------------- ПОЗИЦИИ (ИСПРАВЛЕНО) --------------------
app.get('/api/positions', async (req, res) => {
  try {
    if (!exchangeClient) {
      return res.status(503).json({ error: 'Exchange client not initialized' });
    }
    
    // Получаем позиции с биржи
    const positions = await exchangeClient.getPositions();
    
    // Фильтруем активные позиции (где количество > 0)
    const activePositions = positions.filter(p => 
      parseFloat(p.positionAmt) !== 0
    );
    
    // Преобразуем в удобный формат
    const formatted = activePositions.map(p => ({
      symbol: p.symbol,
      side: p.positionSide || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT'),
      entryPrice: parseFloat(p.entryPrice) || parseFloat(p.avgPrice) || 0,
      quantity: Math.abs(parseFloat(p.positionAmt)),
      unrealizedPnl: parseFloat(p.unrealizedProfit) || 0,
      markPrice: parseFloat(p.markPrice),
      leverage: parseFloat(p.leverage) || 1,
    }));
    
    res.json({
      total: formatted.length,
      long: formatted.filter(p => p.side === 'LONG').length,
      short: formatted.filter(p => p.side === 'SHORT').length,
      positions: formatted,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log.error(`Error fetching positions: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// -------------------- СИГНАЛЫ --------------------
app.get('/api/signals', async (req, res) => {
  try {
    const supabaseUrl = 'https://sbpyuigmrqycqlrjlqqv.supabase.co';
    const supabaseKey = 'sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd';
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.query.user_id || 11;
    
    const response = await fetch(
      `${supabaseUrl}/rest/v1/signals?user_id=eq.${userId}&order=created_at.desc&limit=${limit}`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    log.error(`Error fetching signals: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// -------------------- ИСТОРИЯ СДЕЛОК --------------------
app.get('/api/history', async (req, res) => {
  try {
    const supabaseUrl = 'https://sbpyuigmrqycqlrjlqqv.supabase.co';
    const supabaseKey = 'sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd';
    const limit = parseInt(req.query.limit) || 20;
    const userId = req.query.user_id || 11;
    
    const response = await fetch(
      `${supabaseUrl}/rest/v1/signals?user_id=eq.${userId}&status=eq.executed&order=created_at.desc&limit=${limit}`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    log.error(`Error fetching history: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// -------------------- HEALTH CHECK --------------------
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    exchange_ready: exchangeClient !== null
  });
});

// ============================================
//  ЗАПУСК СЕРВЕРА
// ============================================
async function startServer() {
  log.info('🚀 Starting API Server...');
  
  // Инициализируем клиент биржи
  await initExchangeClient();
  
  app.listen(PORT, '0.0.0.0', () => {
    log.info(`✅ API Server running on port ${PORT}`);
    log.info(`📊 API URL: http://localhost:${PORT}`);
    log.info(`🌐 Public URL: https://bot.smtbot.pro/api`);
  });
}

// Запускаем сервер
startServer().catch(error => {
  log.error(`❌ Failed to start server: ${error.message}`);
  process.exit(1);
});

module.exports = { app, startServer };