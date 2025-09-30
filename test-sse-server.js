// Simple SSE server for testing payment notifications
const express = require('express');
const app = express();

const clients = new Set();

// SSE endpoint
app.get('/payment-events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  clients.add(res);
  console.log(`[SSE] Client connected. Total: ${clients.size}`);

  res.write(`data: ${JSON.stringify({event: 'connected', timestamp: Date.now()})}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`[SSE] Client disconnected. Total: ${clients.size}`);
  });
});

// Test endpoint to simulate payment
app.get('/simulate-payment/:address', (req, res) => {
  const { address } = req.params;

  const message = {
    event: 'payment_received',
    pin: 516,
    address: address,
    drink: 'coke',
    currency: 'sats',
    amount: 1000,
    timestamp: Date.now()
  };

  console.log('[SSE] Broadcasting test payment:', message);

  clients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (error) {
      clients.delete(client);
    }
  });

  res.json({ success: true, message: 'Payment notification sent' });
});

app.listen(3500, () => {
  console.log('[SSE] Test server running on port 3500');
  console.log('Visit: http://localhost:3001 (frontend)');
  console.log('Test payment: curl http://localhost:3500/simulate-payment/sp1pgss8u2xnsh9d29xuanp9jeg8z9687qvhqm7qelp290nd0jwhjg3z3gg4xz0sa');
});