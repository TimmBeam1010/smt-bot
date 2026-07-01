async _signedRequest(method, endpoint, params = {}) {
    const timestamp = Date.now().toString();
    const allParams = { ...params, timestamp };
    
    // 1. Формируем строку параметров в ТОМ ЖЕ ПОРЯДКЕ, что и в примере
    // Сначала все параметры, потом timestamp в конце
    let parameters = '';
    for (const key in allParams) {
        parameters += `${key}=${allParams[key]}&`;
    }
    parameters = parameters.slice(0, -1); // Убираем последний &
    
    // 2. Подпись от СТРОКИ параметров (НЕ от сортированных)
    const signature = crypto
        .createHmac('sha256', this.secretKey)
        .update(parameters)
        .digest('hex');
    
    // 3. Формируем URL (параметры + подпись)
    const queryParams = { ...allParams, signature };
    const queryString = Object.keys(queryParams)
        .map(key => `${key}=${encodeURIComponent(queryParams[key])}`)
        .join('&');
    
    const url = `${this.baseURL}${endpoint}?${queryString}`;
    
    console.log('🔑 Строка для подписи:', parameters);
    console.log('🔑 Подпись:', signature);
    console.log('📤 URL:', url);
    
    const config = {
        method: method,
        url: url,
        headers: {
            'X-BX-APIKEY': this.apiKey,
            'Content-Type': 'application/json'
        }
    };
    
    try {
        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('❌ Ошибка запроса:', error.response?.data || error.message);
        throw error;
    }
}