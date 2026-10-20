import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BinanceTickerStream,
  NOBITEX_STREAM_RESOLUTION,
  NobitexTickerStream,
  parseBinanceKline,
  parseNobitexMessage,
  type StreamRequest,
} from '../src/services/marketData/streams.js';
import type { TickerStreamStatus, TickerTick } from '../src/services/marketData/types.js';

/**
 * These tests use a local WebSocket server, not the exchanges. They exercise
 * exactly the contract the sockets have to honour — subscribe, parse, push a
 * validated tick, resubscribe after a drop — without depending on a live venue
 * or a network route.
 */

const KLINE_EVENT = {
  e: 'kline',
  E: 1_700_000_500_000,
  s: 'BTCUSDT',
  k: {
    t: 1_700_000_400_000,
    T: 1_700_003_900_000,
    s: 'BTCUSDT',
    i: '1h',
    o: '100',
    h: '105',
    l: '98',
    c: '104',
    v: '12.5',
    x: false,
  },
};

async function startServer(): Promise<{
  server: WebSocketServer;
  url: string;
  sockets: WebSocket[];
  messages: string[];
}> {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  const sockets: WebSocket[] = [];
  const messages: string[] = [];
  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('message', (data) => messages.push(data.toString()));
  });
  const { port } = server.address() as AddressInfo;
  return { server, url: `ws://127.0.0.1:${port}`, sockets, messages };
}

async function stopServer(server: WebSocketServer): Promise<void> {
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Poll instead of sleeping for a fixed duration, so tests fail fast. */
async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condition was not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function handlers() {
  const ticks: TickerTick[] = [];
  const statuses: Array<{ status: TickerStreamStatus; detail?: string }> = [];
  return {
    ticks,
    statuses,
    handlers: {
      onTick: (tick: TickerTick) => ticks.push(tick),
      onStatus: (status: TickerStreamStatus, detail?: string) => statuses.push({ status, detail }),
    },
  };
}

let cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

describe('parseBinanceKline', () => {
  it('turns a kline event into a validated tick', () => {
    const parsed = parseBinanceKline(KLINE_EVENT);

    expect(parsed).not.toBeNull();
    expect(parsed!.candle).toEqual({
      time: 1_700_000_400_000,
      open: 100,
      high: 105,
      low: 98,
      close: 104,
      volume: 12.5,
    });
    expect(parsed!.price).toBe(104);
    expect(parsed!.priceDefinition).toBe('forming_candle_close');
    expect(parsed!.eventTime).toBe(1_700_000_500_000);
  });

  it('rejects payloads that are not kline events', () => {
    expect(parseBinanceKline(null)).toBeNull();
    expect(parseBinanceKline('kline')).toBeNull();
    expect(parseBinanceKline({ e: 'trade' })).toBeNull();
    expect(parseBinanceKline({ k: null })).toBeNull();
  });

  it('drops an impossible bar instead of passing it to the engine', () => {
    // Low above high: a corrupt row must never become a candle.
    const corrupt = { ...KLINE_EVENT, k: { ...KLINE_EVENT.k, h: '90', l: '98' } };
    expect(parseBinanceKline(corrupt)).toBeNull();
  });

  it('drops a zero or negative close', () => {
    const zero = { ...KLINE_EVENT, k: { ...KLINE_EVENT.k, o: '0', h: '0', l: '0', c: '0' } };
    expect(parseBinanceKline(zero)).toBeNull();
  });
});

describe('parseNobitexMessage', () => {
  const trade = {
    push: {
      channel: 'public:trades-BTCIRT',
      pub: { data: { price: '4500000000', time: 1_762_781_164_192, type: 'buy', volume: '0.25' } },
    },
  };

  const candle = {
    push: {
      channel: 'public:candle-BTCIRT-60',
      pub: { data: { t: 1_762_779_600, o: 4_500_000_000, h: 4_510_000_000, l: 4_490_000_000, c: 4_505_000_000, v: 3.5 } },
    },
  };

  it('recognises the empty Centrifugo ping', () => {
    expect(parseNobitexMessage({})).toMatchObject({ ping: true, tick: null });
  });

  it('recognises the connect acknowledgement', () => {
    expect(parseNobitexMessage({ connect: { version: '5' } })).toMatchObject({
      status: 'connected',
      tick: null,
    });
  });

  it('surfaces an error frame with its detail', () => {
    const parsed = parseNobitexMessage({ error: { message: 'unknown channel' } });
    expect(parsed.status).toBe('error');
    expect(parsed.detail).toBe('unknown channel');
  });

  it('maps a trade frame to a price-only tick with its size', () => {
    const parsed = parseNobitexMessage(trade);

    expect(parsed.tick).not.toBeNull();
    expect(parsed.tick!.candle).toBeNull();
    expect(parsed.tick!.price).toBe(4_500_000_000);
    expect(parsed.tick!.priceDefinition).toBe('last_trade');
    expect(parsed.tick!.eventTime).toBe(1_762_781_164_192);
    expect(parsed.tick!.tradeVolume).toBe(0.25);
    expect(parsed.tick!.channel).toBe('public:trades-BTCIRT');
  });

  it('maps a candle frame to a millisecond candle', () => {
    const parsed = parseNobitexMessage(candle);

    expect(parsed.tick?.candle).toEqual({
      time: 1_762_779_600_000,
      open: 4_500_000_000,
      high: 4_510_000_000,
      low: 4_490_000_000,
      close: 4_505_000_000,
      volume: 3.5,
    });
    expect(parsed.tick!.priceDefinition).toBe('forming_candle_close');
    expect(parsed.tick!.eventTime).toBeNull();
  });

  it('ignores unrelated channels and malformed frames', () => {
    expect(parseNobitexMessage({ push: { channel: 'public:orders-BTCIRT', pub: { data: {} } } }).tick).toBeNull();
    expect(parseNobitexMessage({ push: { channel: 'public:trades-BTCIRT' } }).tick).toBeNull();
    expect(
      parseNobitexMessage({ push: { channel: 'public:trades-BTCIRT', pub: { data: { price: '0' } } } }).tick,
    ).toBeNull();
    expect(parseNobitexMessage([])).toMatchObject({ tick: null });
  });
});

describe('NOBITEX_STREAM_RESOLUTION', () => {
  it('maps every timeframe the documented candle channel supports', () => {
    expect(NOBITEX_STREAM_RESOLUTION['1h']).toBe('60');
    expect(NOBITEX_STREAM_RESOLUTION['4h']).toBe('240');
    expect(NOBITEX_STREAM_RESOLUTION['1d']).toBe('D');
  });

  it('leaves 1w unmapped, which makes the provider fall back to REST', () => {
    expect(NOBITEX_STREAM_RESOLUTION['1w']).toBeUndefined();
  });
});

describe('BinanceTickerStream', () => {
  it('subscribes, validates a pushed kline and closes cleanly', async () => {
    const { server, url, messages } = await startServer();
    cleanup.push(() => stopServer(server));
    const tape = handlers();
    const stream = new BinanceTickerStream({
      symbol: 'BINANCE:BTCUSDT',
      timeframe: '1h',
      nativeTicker: 'BTCUSDT',
      handlers: tape.handlers,
      url,
    } satisfies StreamRequest & { url: string });
    stream.start();
    cleanup.push(() => stream.close());

    await waitFor(() => messages.length === 1);
    expect(JSON.parse(messages[0]!)).toEqual({
      method: 'SUBSCRIBE',
      params: ['BTCUSDT@kline_1h'],
      id: 1,
    });
    expect(tape.statuses.some((entry) => entry.status === 'connected')).toBe(true);

    for (const socket of server.clients) socket.send(JSON.stringify(KLINE_EVENT));
    await waitFor(() => tape.ticks.length === 1);

    const tick = tape.ticks[0]!;
    expect(tick.symbol).toBe('BINANCE:BTCUSDT');
    expect(tick.timeframe).toBe('1h');
    expect(tick.price).toBe(104);
    expect(tick.priceDefinition).toBe('forming_candle_close');
    expect(tick.venue).toBe('binance');
    expect(tick.streamId).toBe('binance:BTCUSDT@kline_1h');
    expect(tick.candle?.time).toBe(1_700_000_400_000);

    stream.close();
    expect(tape.statuses.at(-1)?.status).toBe('disconnected');
  });

  it('reconnects and resubscribes after the socket drops', async () => {
    const { server, url, messages, sockets } = await startServer();
    cleanup.push(() => stopServer(server));
    const tape = handlers();
    const stream = new BinanceTickerStream({
      symbol: 'BINANCE:BTCUSDT',
      timeframe: '15m',
      nativeTicker: 'BTCUSDT',
      handlers: tape.handlers,
      url,
    });
    stream.start();
    cleanup.push(() => stream.close());

    await waitFor(() => sockets.length === 1 && messages.length >= 1);
    // Drop the connection from the server side, as a flaky exchange would.
    sockets[0]!.terminate();

    await waitFor(() => sockets.length === 2, 4_000);
    await waitFor(() => messages.length >= 2, 4_000);
    expect(JSON.parse(messages[1]!)).toMatchObject({
      method: 'SUBSCRIBE',
      params: ['BTCUSDT@kline_15m'],
    });
  });

  it('ignores a malformed frame without killing the stream', async () => {
    const { server, url, sockets } = await startServer();
    cleanup.push(() => stopServer(server));
    const tape = handlers();
    const stream = new BinanceTickerStream({
      symbol: 'BINANCE:BTCUSDT',
      timeframe: '1h',
      nativeTicker: 'BTCUSDT',
      handlers: tape.handlers,
      url,
    });
    stream.start();
    cleanup.push(() => stream.close());

    await waitFor(() => sockets.length === 1);
    sockets[0]!.send('{not json');
    sockets[0]!.send(JSON.stringify({ k: { t: 1, o: 'x' } }));
    sockets[0]!.send(JSON.stringify(KLINE_EVENT));

    await waitFor(() => tape.ticks.length === 1);
    expect(tape.ticks).toHaveLength(1);
  });
});

describe('NobitexTickerStream', () => {
  it('connects, subscribes to trades and candles, answers pings and pushes ticks', async () => {
    const { server, url, messages, sockets } = await startServer();
    cleanup.push(() => stopServer(server));
    const tape = handlers();
    const stream = new NobitexTickerStream({
      symbol: 'NOBITEX:BTCIRT',
      timeframe: '1h',
      nativeTicker: 'BTCIRT',
      handlers: tape.handlers,
      url,
    });
    stream.start();
    cleanup.push(() => stream.close());

    await waitFor(() => messages.length === 3);
    expect(JSON.parse(messages[0]!)).toEqual({ id: 1, connect: {} });
    expect(JSON.parse(messages[1]!)).toEqual({
      id: 2,
      subscribe: { channel: 'public:trades-BTCIRT' },
    });
    expect(JSON.parse(messages[2]!)).toEqual({
      id: 3,
      subscribe: { channel: 'public:candle-BTCIRT-60' },
    });

    // The stream must answer the server's heartbeat or be disconnected at 20s.
    sockets[0]!.send('{}');
    await waitFor(() => messages.length >= 4);
    expect(messages[3]).toBe('{}');

    // Centrifugo acknowledges the connect before publications may arrive.
    sockets[0]!.send(JSON.stringify({ connect: { version: '5' } }));
    await waitFor(() => tape.statuses.some((entry) => entry.status === 'connected'));

    sockets[0]!.send(
      JSON.stringify({
        push: {
          channel: 'public:trades-BTCIRT',
          pub: { data: { price: '4500000000', time: 1_762_781_164_192, type: 'sell', volume: '0.25' } },
        },
      }),
    );
    await waitFor(() => tape.ticks.length === 1);
    expect(tape.ticks[0]).toMatchObject({
      symbol: 'NOBITEX:BTCIRT',
      price: 4_500_000_000,
      priceDefinition: 'last_trade',
      tradeVolume: 0.25,
      venue: 'nobitex',
    });
    expect(tape.ticks[0]!.candle).toBeNull();

    sockets[0]!.send(
      JSON.stringify({
        push: {
          channel: 'public:candle-BTCIRT-60',
          pub: { data: { t: 1_762_779_600, o: 4_500_000_000, h: 4_510_000_000, l: 4_490_000_000, c: 4_505_000_000, v: 3.5 } },
        },
      }),
    );
    await waitFor(() => tape.ticks.length === 2);
    expect(tape.ticks[1]!.candle?.time).toBe(1_762_779_600_000);
    expect(tape.ticks[1]!.price).toBe(4_505_000_000);
  });

  it('does not subscribe to a candle channel it has no resolution for', async () => {
    const { server, url, messages } = await startServer();
    cleanup.push(() => stopServer(server));
    const tape = handlers();
    const stream = new NobitexTickerStream({
      symbol: 'NOBITEX:BTCIRT',
      timeframe: '1w',
      nativeTicker: 'BTCIRT',
      handlers: tape.handlers,
      url,
    });
    stream.start();
    cleanup.push(() => stream.close());

    await waitFor(() => messages.length === 2);
    expect(JSON.parse(messages[1]!)).toEqual({
      id: 2,
      subscribe: { channel: 'public:trades-BTCIRT' },
    });
    expect(messages.some((message) => message.includes('public:candle'))).toBe(false);
  });
});
