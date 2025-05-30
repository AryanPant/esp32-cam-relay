const WebSocket = require("ws");
const http = require("http");
const https = require("https");
const PORT = process.env.PORT || 10000;

// Create HTTP server first
const server = http.createServer((req, res) => {
  // Enable CORS for web clients
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket Server Running\n');
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ 
  server: server,
  perMessageDeflate: false, // Disable compression for binary data
  clientTracking: true
});

let unityClients = [];
let esp32Clients = [];

console.log(`Starting WebSocket server on port ${PORT}`);

wss.on("connection", (ws, req) => {
  const clientIP = req.socket.remoteAddress || req.connection.remoteAddress;
  console.log(`New connection from ${clientIP}`);
  
  // Initialize client properties
  ws.clientType = "unknown";
  ws.isAlive = true;
  
  // Send a welcome message
  ws.send("connection-established");
  
  ws.on("message", (data) => {
    try {
      // Handle both Buffer and string data
      let msg = data;
      
      // Check if it's a text message
      if (typeof data === 'string') {
        handleTextMessage(ws, data);
      } else if (Buffer.isBuffer(data)) {
        // Try to decode as string first (for identification messages)
        try {
          const textMsg = data.toString('utf8');
          if (textMsg === "unity-client" || textMsg === "esp32-client") {
            handleTextMessage(ws, textMsg);
            return;
          }
        } catch (e) {
          // Not a text message, treat as binary
        }
        
        // Handle binary data (JPEG from ESP32)
        handleBinaryMessage(ws, data);
      } else {
        console.log(`Unknown message type received:`, typeof data);
      }
    } catch (error) {
      console.log("Error processing message:", error.message);
    }
  });
  
  ws.on("close", (code, reason) => {
    console.log(`Connection closed. Code: ${code}, Reason: ${reason?.toString()}`);
    
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
  
  // Handle pong responses
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

function handleTextMessage(ws, msg) {
  console.log(`Received text message: ${msg}`);
  
  if (msg === "unity-client") {
    console.log("Unity client identified and connected");
    if (!unityClients.includes(ws)) {
      unityClients.push(ws);
      ws.clientType = "unity";
    }
    // Send confirmation back to Unity
    ws.send("unity-client-confirmed");
  } else if (msg === "esp32-client") {
    console.log("ESP32 client identified and connected");
    if (!esp32Clients.includes(ws)) {
      esp32Clients.push(ws);
      ws.clientType = "esp32";
    }
    // Send confirmation back to ESP32
    ws.send("esp32-client-confirmed");
  }
}

function handleBinaryMessage(ws, data) {
  console.log(`Received binary data: ${data.length} bytes from ${ws.clientType || 'unknown'} client`);
  
  // Only forward binary data from ESP32 clients to Unity clients
  if (ws.clientType === "esp32" || ws.clientType === "unknown") {
    // Forward to all Unity clients
    let sentCount = 0;
    const deadClients = [];
    
    unityClients.forEach((client, index) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data, { binary: true });
          sentCount++;
        } catch (error) {
          console.log(`Error sending to Unity client ${index}:`, error.message);
          deadClients.push(client);
        }
      } else {
        deadClients.push(client);
      }
    });
    
    // Remove dead clients
    deadClients.forEach(client => {
      const index = unityClients.indexOf(client);
      if (index > -1) {
        unityClients.splice(index, 1);
      }
    });
    
    if (sentCount > 0) {
      console.log(`Frame forwarded to ${sentCount} Unity clients`);
    } else {
      console.log(`No Unity clients available to forward frame`);
    }
  }
}

// Periodic cleanup of dead connections
const cleanupInterval = setInterval(() => {
  // Clean up Unity clients
  const aliveUnityClients = [];
  unityClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      aliveUnityClients.push(client);
    }
  });
  unityClients = aliveUnityClients;
  
  // Clean up ESP32 clients
  const aliveEsp32Clients = [];
  esp32Clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      aliveEsp32Clients.push(client);
    }
  });
  esp32Clients = aliveEsp32Clients;
}, 30000);

// Heartbeat to detect broken connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    
    ws.isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  });
}, 30000);

// Start the server
server.listen(PORT, () => {
  console.log(`WebSocket server listening on port ${PORT}`);
  console.log(`WebSocket URL: ws://localhost:${PORT}/`);
  console.log(`For production, use: wss://your-domain.com/`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  clearInterval(cleanupInterval);
  clearInterval(heartbeat);
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Log connection status every minute
setInterval(() => {
  console.log(`Status - Unity clients: ${unityClients.length}, ESP32 clients: ${esp32Clients.length}`);
  console.log(`Total WebSocket connections: ${wss.clients.size}`);
}, 60000);
