const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_URL = 'https://bot.smtbot.com';

// ============================================
//  МАРШРУТЫ ДЛЯ ТЕРМИНАЛА
// ============================================

// --- СТАТУС БОТА ---
app.get('/api/status', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/status`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// --- БАЛАНС ---
app.get('/api/balance', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/balance`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ПОЗИЦИИ ---
app.get('/api/positions', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/positions`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// --- ИСТОРИЯ ---
app.get('/api/history', async (req, res) => {
    try { const r = await axios.get(`${API_URL}/api/history`); res.json(r.data); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// --- АКТИВНЫЕ СИГНАЛЫ ---
app.get('/api/signals', async (req, res) => {
    try {
        const r = await axios.get(`${API_URL}/api/signals`);
        // Дополнительная фильтрация: только pending и active
        const signals = r.data.signals || [];
        const activeSignals = signals.filter(s => s.status === 'pending' || s.status === 'active');
        res.json({ signals: activeSignals });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- ОТКРЫТЫЕ СДЕЛКИ (С ПРИВЯЗКОЙ К СИГНАЛАМ) ---
app.get('/api/trades', async (req, res) => {
    try {
        // Получаем открытые позиции с биржи
        const posRes = await axios.get(`${API_URL}/api/positions`);
        const positions = posRes.data || [];
        
        // Получаем исполненные сигналы
        const sigRes = await axios.get(`${API_URL}/api/signals`);
        const signals = sigRes.data.signals || [];
        const executedSignals = signals.filter(s => s.status === 'executed');

        // Объединяем данные
        const trades = positions.map(pos => {
            const matchedSignal = executedSignals.find(s => s.symbol === pos.symbol);
            return {
                symbol: pos.symbol,
                side: pos.side || pos.positionSide || 'LONG',
                entryPrice: pos.entryPrice || matchedSignal?.entry_price || 0,
                currentPrice: pos.markPrice || pos.lastPrice || 0,
                stopLoss: matchedSignal?.stop_loss || pos.stopLoss || 0,
                takeProfit: matchedSignal?.take_profit || pos.takeProfit || 0,
                size: pos.size || pos.quantity || 0,
                pnl: pos.pnl || pos.unrealizedPnl || 0
            };
        });

        res.json({ trades });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================
//  WEBSOCKET ДЛЯ РЕАЛЬНОГО ВРЕМЕНИ
// ============================================
io.on('connection', (socket) => {
    console.log('📊 Клиент подключен');
    
    const sendData = async () => {
        try {
            const [b, p, s, t] = await Promise.all([
                axios.get(`${API_URL}/api/balance`, { timeout: 5000 }),
                axios.get(`${API_URL}/api/positions`, { timeout: 5000 }),
                axios.get(`${API_URL}/api/signals`, { timeout: 5000 }),
                axios.get(`${API_URL}/api/trades`, { timeout: 5000 })
            ]);
            
            const data = {
                balance: b.data.balance || 0,
                positions: p.data || { total: 0, long: 0, short: 0 },
                signals: s.data.signals || [],
                trades: t.data.trades || [],
                timestamp: new Date().toISOString()
            };
            
            socket.emit('data', data);
        } catch (e) {
            console.error('❌ Ошибка:', e.message);
            socket.emit('error', { message: 'Ошибка получения данных' });
        }
    };
    
    sendData();
    const interval = setInterval(sendData, 3000);
    
    socket.on('disconnect', () => {
        clearInterval(interval);
        console.log('📊 Клиент отключен');
    });
});

// ============================================
//  ЗАПУСК
// ============================================
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`📊 Terminal запущен на порту ${PORT}`);
    console.log(`🌐 Открой: http://localhost:${PORT}/`);
});