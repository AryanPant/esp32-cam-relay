const WebSocket = require("ws");
const http = require("http");

const PORT = process.env.PORT || 10000;

// Create HTTP server first
const server = http.createServer((req, res) => {
  // Simple HTTP response for health checks
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket Server Running\n');
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ 
  server: server,
  perMessageDeflate: false // Disable compression for binary data
});

let unityClients = [];
let esp32Clients = [];

console.log(`Starting WebSocket server on port ${PORT}`);

wss.on("connection", (ws, req) => {
  const clientIP = req.connection.remoteAddress;
  console.log(`New connection from ${clientIP}`);
  
  // Send a welcome message to identify connection type
  ws.send("connection-established");
  
  ws.on("message", (msg) => {
    try {
      if (typeof msg === "string") {
        console.log(`Received text message: ${msg}`);
        
        if (msg === "unity-client") {
          console.log("Unity client connected");
          unityClients.push(ws);
          ws.clientType = "unity";
        } else if (msg === "esp32-client") {
          console.log("ESP32 client connected");
          esp32Clients.push(ws);
          ws.clientType = "esp32";
        }
      } else {
        // Binary data (JPEG from ESP32)
        console.log(`Received binary data: ${msg.length} bytes`);
        
        // Forward to all Unity clients
        let sentCount = 0;
        unityClients.forEach((client, index) => {
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(msg);
              sentCount++;
            } catch (error) {
              console.log(`Error sending to Unity client ${index}:`, error.message);
            }
          }
        });
        
        if (sentCount > 0) {
          console.log(`Frame forwarded to ${sentCount} Unity clients`);
        }
      }
    } catch (error) {
      console.log("Error processing message:", error.message);
    }
  });
  
  ws.on("close", (code, reason) => {
    console.log(`Connection closed. Code: ${code}, Reason: ${reason}`);
    
    // Remove from appropriate client list
    if (ws.clientType === "unity") {
      unityClients = unityClients.filter(c => c !== ws);
      console.log(`Unity client disconnected. Remaining: ${unityClients.length}`);
    } else if (ws.clientType === "esp32") {
      esp32Clients = esp32Clients.filter(c => c !== ws);
      console.log(`ESP32 client disconnected. Remaining: ${esp32Clients.length}`);
    }
  });
  
  ws.on("error", (error) => {
    console.log("WebSocket error:", error.message);
  });
  
  // Send periodic ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000); // Ping every 30 seconds
});

// Start the server
server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
  console.log(`WebSocket URL: ws://localhost:${PORT}/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Log connection status every minute
setInterval(() => {
  console.log(`Status - Unity clients: ${unityClients.length}, ESP32 clients: ${esp32Clients.length}`);
}, 60000);
