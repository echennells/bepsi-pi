// Server-Sent Events for payment notifications
const clients = new Set();

// SSE endpoint for payment events
const setupPaymentEvents = (app) => {
  app.get('/payment-events', (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Add client to active connections
    clients.add(res);
    // console.log(`[SSE] Client connected. Total clients: ${clients.size}`);

    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({
      event: 'connected',
      timestamp: Date.now()
    })}\n\n`);

    // Keep connection alive with heartbeat
    const heartbeat = setInterval(() => {
      res.write(':heartbeat\n\n');
    }, 30000);

    // Clean up on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      clients.delete(res);
      // console.log(`[SSE] Client disconnected. Total clients: ${clients.size}`);
    });
  });
};

// Notify all connected clients of a payment
const notifyPaymentSuccess = (pinNo, sparkAddress, drinkName, currency, amount) => {
  const message = {
    event: 'payment_received',
    pin: pinNo,
    address: sparkAddress,
    drink: drinkName,
    currency: currency,
    amount: amount,
    timestamp: Date.now()
  };

  console.log(`[SSE] Broadcasting payment notification:`, message);

  // Send to all connected clients
  clients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify(message)}\n\n`);
    } catch (error) {
      // Remove dead connections
      clients.delete(client);
      console.log(`[SSE] Removed dead client. Total clients: ${clients.size}`);
    }
  });
};

module.exports = {
  setupPaymentEvents,
  notifyPaymentSuccess
};