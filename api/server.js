const express = require('express');
const cors = require('cors');
const { getExchange } = require('../shared/exchanges');
const app = express();

app.use(cors());
app.use(express.json());

let exchangeClient = null;

function initExchange() {
    if (!exchangeClient) {
        exchangeClient = getExchange('bingx',
            process.env.BINGX_API_KEY || 'BOe6nx3Hlo8puQvg2wPIjNCWW4ISUY7SdYNlvi2jDApQr50hDvbv6At4vBoSDVN9o9LcEgEI4dcOkgY52A',
            process.env.BINGX_SECRET_KEY || 'jxHUWSOdzIT0K82tq5EUCjU6U36TRUocXAzjHEl9Jro2Z550amZqsTbNHJqj3gs8m7cXL3ANMRYDhivqZvWMA'
        );
    }
    return exchangeClient;
}

// Статус
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        version: '3.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Реальный баланс с BingX
app.get('/api/balance', async (req, res) => {
    try {
        const client = initExchange();
        const balance = await client.getBalance();
        res.json({ 
            balance: balance || 0, 
            currency: 'USDT',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ========================================
//  ПОЛУЧЕНИЕ ПОЗИЦИЙ
// ========================================
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
      entryPrice: parseFloat(p.entryPrice),
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
    console.error('Error fetching positions:', error);
    res.status(500).json({ error: error.message });
  }
});

// История (заглушка)
app.get('/api/history', (req, res) => {
    res.json([]);
});

app.post('/api/params', (req, res) => {
    console.log('📊 Получены параметры:', req.body);
    res.json({ status: 'ok', received: true });
});

const PORT = 5001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🔌 API сервер запущен на порту ${PORT}`);
    console.log(`📡 Доступен: http://89.108.71.175:${PORT}/api/status`);
});

module.exports = app;

// Получение сигналов из Supabase
app.get('/api/signals', async (req, res) => {
    try {
        const supabaseUrl = 'https://sbpyuigmrqycqlrjlqqv.supabase.co';
        const supabaseKey = 'sb_publishable_TRnw7p3BXwp9_AbHiJR55A_yJBtEyGd';
        
        const response = await fetch(`${supabaseUrl}/rest/v1/signals?select=*&order=created_at.desc&limit=10`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });
        
        const data = await response.json();
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
