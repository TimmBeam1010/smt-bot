async getBalance() {
    try {
        const timestamp = Date.now().toString();
        const signature = crypto
            .createHmac('sha256', this.secretKey)
            .update(`timestamp=${timestamp}`)
            .digest('hex');
        
        const url = `${this.baseURL}/openApi/swap/v3/user/balance?timestamp=${timestamp}&signature=${signature}`;
        
        const response = await axios.get(url, {
            headers: { 'X-BX-APIKEY': this.apiKey }
        });
        
        if (response?.data?.code === 0) {
            // data - это МАССИВ активов
            const assets = response.data.data || [];
            const usdtData = assets.find(item => item.asset === 'USDT');
            if (usdtData) {
                return parseFloat(usdtData.equity) || parseFloat(usdtData.balance) || 0;
            }
            return 0;
        }
        console.error('❌ Баланс:', response?.data);
        return null;
    } catch (error) {
        console.error('❌ Ошибка getBalance:', error.message);
        return null;
    }
}