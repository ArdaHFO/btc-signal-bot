const WebSocket = require('ws');
const { EMA, RSI, ATR } = require('technicalindicators');
const { sendTelegramMessage } = require('./notify');
require('dotenv').config();
const axios = require('axios');

// --- Yapılandırma Parametreleri ---
const SYMBOL = 'btcusdt';
const TIMEFRAME = '1m';
const WS_URL = `wss://stream.binance.com:9443/ws/${SYMBOL}@kline_${TIMEFRAME}`;
const REST_API_URL = `https://api.binance.com/api/v3/klines`;

const EMA_SHORT_PERIOD = 5;
const EMA_LONG_PERIOD = 21;
const RSI_PERIOD = 14;

const ATR_PERIOD = 7;

const COOLDOWN_MS = 10 * 1000;

const RSI_BUY_LOWER = 40;
const RSI_BUY_UPPER = 75;
const RSI_SELL_LOWER = 25;
const RSI_SELL_UPPER = 80;

const PRICE_CHANGE_MULTIPLIER_BUY = 0.5;
const PRICE_CHANGE_MULTIPLIER_SELL = 0.5;

const EMA_DIFF_MULTIPLIER = 0.05;

const STOP_LOSS_PERCENTAGE = 0.007; // %0.7 zarar kes

// --- Komisyon Parametreleri ---
const COMMISSION_RATE = 0.001; // %0.1 Binance spot komisyon oranı (BNB ile ödeme yapılıyorsa 0.00075 yap)
const MIN_PROFIT_TARGET_PERCENTAGE = 0.002; // %0.2 minimum kar hedefi (komisyonları karşılayıp üzerine küçük kar almak için)

// --- Bakiye Takibi ---
const INITIAL_CAPITAL = 20000; // Başlangıç sermayesi (USDT cinsinden)
let currentCapital = INITIAL_CAPITAL; // Güncel sermaye
let lastPositionAmount = 0; // Son alınan pozisyonun miktarı (AL işleminde harcanan USDT miktarı)

// --- Dahili Değişkenler ---
let lastSignalTime = 0;
let lastBuyPrice = null; // Kripto biriminin alış fiyatı (komisyonsuz)
let positionCostBasis = null; // Kripto biriminin komisyonlar dahil toplam maliyeti
let lastTradeType = null; // 'BUY' (long pozisyondayız) veya null (nakitteyiz / pozisyonda değiliz)

const priceHistory = [];
const highHistory = [];
const lowHistory = [];
const closeHistory = [];

const MIN_REQUIRED_HISTORY_LENGTH = Math.max(EMA_LONG_PERIOD, RSI_PERIOD, ATR_PERIOD) + 2;

let ws;
let lastCandleCloseTime = 0;

// --- "TUT" Mesajı Zamanlayıcısı ---
const HOLD_MESSAGE_INTERVAL_MS = 1 * 60 * 1000; // 1 dakikada bir "TUT" mesajı (eğer sinyal yoksa)
let lastTradeOrSignalTime = Date.now(); // En son işlem veya sinyal zamanı

async function fetchInitialKlineData() {
    try {
        console.log(`🚀 Geçmiş ${MIN_REQUIRED_HISTORY_LENGTH} adet ${TIMEFRAME} mum verisi çekiliyor...`);
        const response = await axios.get(REST_API_URL, {
            params: {
                symbol: SYMBOL.toUpperCase(),
                interval: TIMEFRAME,
                limit: MIN_REQUIRED_HISTORY_LENGTH + 1
            },
            timeout: 15000
        });

        if (response.data && Array.isArray(response.data)) {
            response.data.forEach(kline => {
                if (!Array.isArray(kline)) return;
                const closeTime = Number(kline[6]);
                const high = Number(kline[2]);
                const low = Number(kline[3]);
                const close = Number(kline[4]);
                if (![closeTime, high, low, close].every(Number.isFinite) ||
                    closeTime >= Date.now() || closeTime <= lastCandleCloseTime) return;
                highHistory.push(high);
                lowHistory.push(low);
                closeHistory.push(close);
                priceHistory.push(close);
                lastCandleCloseTime = closeTime;
            });
            while (priceHistory.length > MIN_REQUIRED_HISTORY_LENGTH) {
                priceHistory.shift();
                highHistory.shift();
                lowHistory.shift();
                closeHistory.shift();
            }
            console.log(`✅ ${priceHistory.length} adet geçmiş mum verisi yüklendi.`);
        } else {
            console.error("❌ Geçmiş veri çekilemedi veya formatı hatalı.");
        }
    } catch (error) {
        console.error("❌ Geçmiş mum verisi çekilirken hata oluştu:", error.message);
        process.exit(1);
    }
}

function connectWebSocket() {
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`📡 Binance WebSocket bağlantısı kuruldu: ${SYMBOL}@${TIMEFRAME}`);
    // Sadece bot başlangıcında bir kez durum mesajı gönder
    if (closeHistory.length > 0) {
        sendTelegramMessage(`🤖 Bot başlatıldı! Anlık Fiyat: ${closeHistory.at(-1).toFixed(2)}\nBaşlangıç Sermayesi: ${INITIAL_CAPITAL.toFixed(2)} USDT`);
    } else {
        sendTelegramMessage(`🤖 Bot başlatıldı! (Fiyat bekleniyor)\nBaşlangıç Sermayesi: ${INITIAL_CAPITAL.toFixed(2)} USDT`);
    }
    lastTradeOrSignalTime = Date.now(); // Bot başladığında zamanı sıfırla
  });

  ws.on('message', (data) => {
    let parsed;
    try {
        parsed = JSON.parse(data.toString());
    } catch {
        console.warn('Malformed WebSocket message ignored.');
        return;
    }
    const candle = parsed && parsed.k;
    if (!candle || candle.x !== true) return;
    const closeTime = Number(candle.T);
    if (!Number.isFinite(closeTime) || closeTime <= lastCandleCloseTime) return;

    const open = parseFloat(candle.o);
    const high = parseFloat(candle.h);
    const low = parseFloat(candle.l);
    const close = parseFloat(candle.c); // Güncel kapanış fiyatı

    if (![close, high, low, open].every(Number.isFinite)) return;
    lastCandleCloseTime = closeTime;

    if (priceHistory.length >= MIN_REQUIRED_HISTORY_LENGTH) {
        priceHistory.shift();
        highHistory.shift();
        lowHistory.shift();
        closeHistory.shift();
    }
    priceHistory.push(close);
    highHistory.push(high);
    lowHistory.push(low);
    closeHistory.push(close);


    if (priceHistory.length < MIN_REQUIRED_HISTORY_LENGTH) {
        console.log(`⏳ Veri toplanıyor... (${priceHistory.length}/${MIN_REQUIRED_HISTORY_LENGTH})`);
        return;
    }

    const emaShort = EMA.calculate({ period: EMA_SHORT_PERIOD, values: priceHistory });
    const emaLong = EMA.calculate({ period: EMA_LONG_PERIOD, values: priceHistory });
    const rsi = RSI.calculate({ period: RSI_PERIOD, values: priceHistory });
    const atr = ATR.calculate({ high: highHistory, low: lowHistory, close: closeHistory, period: ATR_PERIOD });

    const currentEMAShort = emaShort.at(-1);
    const currentEMALong = emaLong.at(-1);
    const currentRSI = rsi.at(-1);
    const currentATR = atr.at(-1);
    const previousClose = closeHistory.at(-2);

    const now = Date.now();

    if (![currentEMAShort, currentEMALong, currentRSI, currentATR, previousClose].every(Number.isFinite)) {
        console.log("⚠️ Gösterge hesaplamaları tamamlanmadı veya yeterli geçmiş veri yok, bekliyor...");
        return;
    }

    const emaDiff = Math.abs(currentEMAShort - currentEMALong);
    const atrEmaDiffThreshold = currentATR * EMA_DIFF_MULTIPLIER;

    // --- AL Sinyali Mantığı (Sadece pozisyonda değilsek) ---
    if (
      lastTradeType === null && // Sadece pozisyonda değilsek AL sinyali ara
      (now - lastSignalTime >= COOLDOWN_MS) &&
      currentEMAShort > currentEMALong && // Hızlı EMA yavaş EMA üzerinde
      currentRSI >= RSI_BUY_LOWER && currentRSI <= RSI_BUY_UPPER && // RSI alım momentumunda
      close > previousClose + (currentATR * PRICE_CHANGE_MULTIPLIER_BUY) && // Fiyat, önceki mum kapanışından ATR * çarpan kadar artmalı
      emaDiff > atrEmaDiffThreshold // EMA'lar yeterince ayrılmış (trend gücü)
    ) {
        // Tüm bakiye ile alım yapıldığı varsayımı
        lastPositionAmount = currentCapital; // Pozisyona girerken harcanan miktar
        lastBuyPrice = close; // Kripto biriminin alış fiyatı
        positionCostBasis = close * (1 + COMMISSION_RATE); // Gerçek maliyet (alış fiyatı + alım komisyonu)

        // Alım komisyonu positionCostBasis içindedir ve çıkıştaki net K/Z'de bir kez düşülür.

        sendTelegramMessage(
            `📈 AL SİNYALİ!\nFiyat: ${close.toFixed(2)}\nEMA${EMA_SHORT_PERIOD}: ${currentEMAShort.toFixed(2)} | EMA${EMA_LONG_PERIOD}: ${currentEMALong.toFixed(2)}\nRSI(${RSI_PERIOD}): ${currentRSI.toFixed(1)}\nATR(${ATR_PERIOD}): ${currentATR.toFixed(2)}\nGüncel Bakiye: ${currentCapital.toFixed(2)} USDT`
        );
        lastSignalTime = now;
        lastTradeType = 'BUY'; // Pozisyonu 'BUY' olarak işaretle
        lastTradeOrSignalTime = now; // Yeni bir sinyal geldiğinde zamanı güncelle
        console.log(`✅ AL sinyali gönderildi. Giriş Fiyatı: ${lastBuyPrice.toFixed(2)}, Maliyet Bazı: ${positionCostBasis.toFixed(2)}`);
    }

    // --- SAT Sinyali Mantığı (Sadece AL pozisyonundaysak) ---
    // Mevcut AL pozisyonunu kapatma (Take Profit / Stop Loss / Trend Dönüşü)
    if (lastTradeType === 'BUY') { // Sadece bir AL pozisyonundaysak bu bloğu kontrol et
        let shouldCloseLongPosition = false;
        let reason = "Bilinmiyor";

        // Mevcut fiyattan satış komisyonunu düşerek net satış fiyatını hesapla
        const currentPriceAfterSellFee = close * (1 - COMMISSION_RATE);
        // Net Kar/Zarar: (Net Satış Fiyatı) - (Pozisyonun Toplam Maliyeti)
        // positionCostBasis aslında birim başına maliyet, lastPositionAmount ise toplam miktar.
        // Bu yüzden toplam kar/zararı hesaplarken orantı kurmalıyız.
        const profitLossPerUnit = currentPriceAfterSellFee - positionCostBasis; // Birim başına kar/zarar
        const totalProfitLoss = (lastPositionAmount / lastBuyPrice) * profitLossPerUnit; // Toplam pozisyon için kar/zarar

        const netProfitLossPercentage = (totalProfitLoss / lastPositionAmount) * 100; // Toplam bakiye değişim yüzdesi

        // 1. Zarar Kes (Stop-Loss)
        if (netProfitLossPercentage <= -STOP_LOSS_PERCENTAGE * 100) {
            shouldCloseLongPosition = true;
            reason = `Zarar Kes (Net ${netProfitLossPercentage.toFixed(2)}%)`;
        }
        // 2. Kar Al veya Trend Dönüşü
        else if (currentEMAShort < currentEMALong) { // EMA ölüm kesişimi (bearish crossover)
            if (totalProfitLoss > 0) { // Kârlı ise
                shouldCloseLongPosition = true;
                reason = "EMA bearish crossover (Kârlı Çıkış)";
            } else { // Zarardaysak ve trend dönüyorsa zararı minimize etmek için çık
                shouldCloseLongPosition = true;
                reason = "EMA bearish crossover (Zarar Minimize)";
            }
        }
        else if (currentRSI > RSI_SELL_UPPER && close < previousClose) { // RSI aşırı alım bölgesinde ve fiyat düşüşe geçmişse
            if (totalProfitLoss > 0) { // Sadece kârlı ise bu sinyalle çık
                shouldCloseLongPosition = true;
                reason = "RSI aşırı alım dönüşü (Kârlı Çıkış)";
            }
        }
        else if (close < previousClose - (currentATR * PRICE_CHANGE_MULTIPLIER_SELL)) { // Fiyat ATR bazında düşüş yaşamışsa (momentum kaybı)
            if (totalProfitLoss > 0) { // Sadece kârlı ise bu sinyalle çık
                shouldCloseLongPosition = true;
                reason = "Fiyat ATR bazında düşüş (momentum kaybı, Kârlı Çıkış)";
            }
        }
        // Ek Kar Al koşulu: Fiyat yeterince yükseldiyse ve komisyonları aştıysa kar al
        else if (netProfitLossPercentage >= MIN_PROFIT_TARGET_PERCENTAGE * 100) {
            shouldCloseLongPosition = true;
            reason = `Hedef Kara Ulaşıldı (Net ${netProfitLossPercentage.toFixed(2)}%)`;
        }


        if (shouldCloseLongPosition) {
            // Bakiyeyi güncelle
            currentCapital += totalProfitLoss; // Mevcut kar/zararı bakiyeye ekle

            const totalPerformancePercentage = ((currentCapital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

            sendTelegramMessage(
              `📉 SAT SİNYALİ (Pozisyon Kapatma)!\nSebep: ${reason}\nFiyat: ${close.toFixed(2)}\nNet K/Z: ${netProfitLossPercentage.toFixed(2)}%\n\n🚨 Güncel Bakiye: ${currentCapital.toFixed(2)} USDT\n🚨 Toplam Performans: ${totalPerformancePercentage.toFixed(2)}%`
            );
            lastSignalTime = now;
            lastTradeType = null; // Pozisyonu kapatınca nakite geçtik
            lastTradeOrSignalTime = now; // Yeni bir sinyal geldiğinde zamanı güncelle
            // Pozisyon değişkenlerini sıfırla
            lastBuyPrice = null;
            positionCostBasis = null;
            lastPositionAmount = 0; // Harcanan miktarı sıfırla
            console.log('✅ SAT sinyali gönderildi (Long Pozisyon Kapatma)');
        }
    }

    const currentStatus = lastTradeType === 'BUY' ? `LONG @${lastBuyPrice ? lastBuyPrice.toFixed(2) : 'N/A'}` : 'NAKİT';
    let currentNetKzText = '';
    if (lastTradeType === 'BUY' && positionCostBasis && lastBuyPrice && lastPositionAmount > 0) {
        const currentPriceAfterSellFee = close * (1 - COMMISSION_RATE);
        const profitLossPerUnit = currentPriceAfterSellFee - positionCostBasis;
        const totalProfitLoss = (lastPositionAmount / lastBuyPrice) * profitLossPerUnit;
        const netProfitLossPercentage = (totalProfitLoss / lastPositionAmount) * 100;
        currentNetKzText = ` | Net K/Z: ${netProfitLossPercentage.toFixed(2)}%`;
    }

    console.log(
      `📊 ${new Date().toLocaleTimeString()} | Fiyat: ${close.toFixed(2)} | EMA${EMA_SHORT_PERIOD}: ${currentEMAShort.toFixed(2)} | EMA${EMA_LONG_PERIOD}: ${currentEMALong.toFixed(2)} | RSI(${RSI_PERIOD}): ${currentRSI.toFixed(1)} | ATR(${ATR_PERIOD}): ${currentATR.toFixed(2)} | EMA Diff: ${emaDiff.toFixed(2)} | Eşik: ${atrEmaDiffThreshold.toFixed(2)} | Durum: ${currentStatus}${currentNetKzText}`
    );
  });

  ws.on('error', (error) => {
      console.error('❌ WebSocket hatası:', error);
  });

  ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket bağlantısı kapatıldı. Kod: ${code}, Neden: ${reason}`);
      console.log("🔄 WebSocket yeniden bağlanmaya çalışıyor...");
      setTimeout(connectWebSocket, 5000);
  });
}

// Botu başlat
async function startBot() {
    await fetchInitialKlineData();
    connectWebSocket();

    // --- "TUT" mesajı zamanlayıcısını başlat ---
    setInterval(() => {
        const now = Date.now();
        const secondsSinceLastTradeOrSignal = ((now - lastTradeOrSignalTime) / 1000).toFixed(0);
        console.log(`TUT kontrolü: ${secondsSinceLastTradeOrSignal} saniye geçti. lastTradeType: ${lastTradeType || 'NAKİT'}`);
        if (now - lastTradeOrSignalTime >= HOLD_MESSAGE_INTERVAL_MS) {
            let message = '';
            const currentPrice = closeHistory.at(-1);
            if (!Number.isFinite(currentPrice)) return;

            if (lastTradeType === 'BUY') { // Pozisyonda ise
                // Kar/Zarar hesaplaması: Net satış fiyatı - Maliyet Bazı
                const currentPriceAfterSellFee = currentPrice * (1 - COMMISSION_RATE);
                const profitLossPerUnit = currentPriceAfterSellFee - positionCostBasis; // Birim başına kar/zarar
                const totalProfitLoss = (lastPositionAmount / lastBuyPrice) * profitLossPerUnit; // Toplam pozisyon için kar/zarar

                const netProfitLossPercentage = (totalProfitLoss / lastPositionAmount) * 100;

                message = `🟢 TUT (AL Pozisyonunda)! Fiyat: ${currentPrice.toFixed(2)} | Giriş Maliyet: ${positionCostBasis.toFixed(2)} | Net K/Z: ${netProfitLossPercentage.toFixed(2)}%`;
            } else { // lastTradeType === null (Pozisyonda değilse)
                const totalPerformancePercentage = ((currentCapital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
                message = `😏 TUT (NAKİT)! Yeni AL sinyali bekleniyor...\nGüncel Bakiye: ${currentCapital.toFixed(2)} USDT\nToplam Performans: ${totalPerformancePercentage.toFixed(2)}%`;
            }
            sendTelegramMessage(message);
            lastTradeOrSignalTime = now; // TUT mesajı gönderildiğinde zamanlayıcıyı sıfırla
            console.log(`✅ "${message}" mesajı gönderildi.`);
        }
    }, HOLD_MESSAGE_INTERVAL_MS);
}

startBot();
