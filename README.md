BTC Signal Bot sends Telegram alerts from Bitcoin price indicators and tracks a simulated position.


<h1 align="center">BTC Signal Bot</h1>

<p align="center">
  <strong>English</strong> · <a href="README.tr.md">Türkçe</a><br />
  <a href="#run-locally"><strong>Run locally</strong></a> ·
  <a href="#how-signals-work">Signal logic</a> ·
  <a href="https://github.com/ArdaHFO/btc-signal-bot/issues">Report an issue</a>
</p>

It reads completed one-minute BTC/USDT candles from Binance and uses EMA, RSI and ATR rules to send Turkish entry, exit and hold messages. It does not place exchange orders. Position and balance messages describe an in-memory simulation.

## Run locally

| Requirement | Current source |
| --- | --- |
| Runtime | Node.js 22.9+ is a compatible choice for the checked-in dependency engine range |
| Package manager | npm and the supplied `package-lock.json` |
| Market connection | Public Binance REST and WebSocket market-data endpoints |
| Notifications | Your own Telegram bot token and one or more chat IDs |
| Default stream | `BTCUSDT`, one-minute candles |

The project does not declare a Node.js engine range, but the locked `npm` dependency requires `^20.17.0 || >=22.9.0`.

```bash
git clone https://github.com/ArdaHFO/btc-signal-bot.git
cd btc-signal-bot
npm ci
```

Create a local `.env` file in the repository root with your own values. The notification module expects the plural `TELEGRAM_CHAT_IDS` setting.

```dotenv
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_IDS=your_chat_id,another_chat_id
```

Use a bot and chats you control. `.env` is ignored by Git. The optional `chatid.js` utility reads the same `TELEGRAM_BOT_TOKEN` variable. It requests Telegram updates to look up chat IDs.

Start the bot. This command connects to Binance and can immediately send a startup message, followed by signals and periodic hold messages to every configured chat.

```bash
npm start
```

Stop it with `Ctrl+C`. No Binance account key is needed because the application only reads public market data.

## Data and alerts

- Indicators start from completed REST candles. The WebSocket handler processes closed candles and skips malformed messages or repeated close timestamps.
- EMA 5/21 gives the trend relationship, RSI 14 filters momentum, and ATR 7 sets movement and EMA-separation thresholds.
- The default script tracks one simulated long position and includes the reason in exit alerts.
- `notify.js` sends each message to all comma-separated chat IDs.
- A one-minute timer sends position or waiting updates when no recent signal was sent.
- The WebSocket reconnects five seconds after a close.

## How signals work

The default entry point is [`index.js`](index.js), selected by `npm start`. Strategy settings are constants near the top of that file, rather than `.env` options.

| Setting | Default behavior |
| --- | --- |
| Entry | No simulated position, fast EMA above slow EMA, RSI in the configured range, and ATR-based price/separation filters |
| Cooldown | 10 seconds between qualifying entry signals |
| Exit | Simulated stop loss, bearish EMA relationship, qualifying momentum reversal, or simulated profit target |
| Fee assumption | 0.1% per side in the illustrative capital calculation |
| Stop-loss threshold | 0.7% in the simulated net-return calculation |
| Profit target | 0.2% in the simulated net-return calculation |

The code compares the current EMA values. It does not require a newly observed crossover between two successive candles. The starting capital is an illustrative constant of 20,000 USDT. Messages use the feed's quote currency. Entry commission is included in the cost basis and deducted once in net profit/loss when the simulated position closes.

[`BEST.js`](BEST.js) is an alternative strategy script with different position/status behavior. It is not the default launch target and should be reviewed separately before use.

## Development and limitations

The source is a small CommonJS application. `ws` handles streaming, `axios` handles HTTP, `technicalindicators` supplies the indicators, and `dotenv` loads local notification configuration.

Syntax checks can inspect the scripts without starting a market connection or sending a Telegram message.

```bash
node --check index.js
node --check BEST.js
node --check notify.js
```

There is no automated test suite, backtest engine or CI workflow. Strategy performance is not validated.

Current limits include in-memory state that resets on restart, no recovery of candles missed during a disconnect, and no durable trade ledger. The simulated capital calculation has not been independently reconciled. These constraints matter when interpreting alerts or the displayed performance percentage.

## Repository map

| Path | Purpose |
| --- | --- |
| [`index.js`](index.js) | Default candle processing, strategy and simulated balance |
| [`notify.js`](notify.js) | Environment-configured Telegram delivery |
| [`BEST.js`](BEST.js) | Alternative strategy implementation |
| [`chatid.js`](chatid.js) | Environment-configured standalone chat lookup helper |
| [`package.json`](package.json) | Start command and declared dependencies |
| [`package-lock.json`](package-lock.json) | Locked dependency graph |

The repository also contains a tracked `node_modules` tree. Use the manifests and `npm ci` for your local dependency installation rather than treating those checked-in files as a portable environment.

## Contributing

Open an issue with the Node.js version, script, expected behavior and steps to reproduce. For signal changes, include closed-candle examples and the expected position transition. Remove tokens and chat IDs from reports and commits.

## License and credits

No project-level license file is present. Dependencies retain their own licenses. Market data comes from Binance, notifications use Telegram, and `technicalindicators` supplies the indicator calculations. The project is not affiliated with those services.
