const WebSocket = require("ws");
const http = require("http");
const PORT = process.env.PORT || 10000;

// Create HTTP server first
const server = http.createServer((req, res) => {
    // Simple HTTP response for health checks
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'running',
        timestamp: new Date().toISOString(),
        clients: {
            unity: unityClients.length,
            esp32: esp32Clients.length
        }
    }));
});

// Create WebSocket server attached to HTTP server
const wss = new WebSocket.Server({ 
    server: server,
    perMessageDeflate: false, // Disable compression for binary data
    maxPayload: 1024 * 1024 * 2 // 2MB max payload for large images
});

let unityClients = [];
let esp32Clients = [];
let frameCount = 0;
let lastFrameTime = Date.now();

console.log(`Starting WebSocket server on port ${PORT}`);

// Cleanup function to remove dead connections
function cleanupDeadConnections() {
    unityClients = unityClients.filter(client => client.readyState === WebSocket.OPEN);
    esp32Clients = esp32Clients.filter(client => client.readyState === WebSocket.OPEN);
}

wss.on("connection", (ws, req) => {
    const clientIP = req.connection.remoteAddress || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    console.log(`New connection from ${clientIP} - ${userAgent}`);
    
    // Connection timeout - close if no identification within 30 seconds
    const identificationTimeout = setTimeout(() => {
        if (!ws.clientType) {
            console.log(`Closing unidentified connection from ${clientIP}`);
            ws.close(1000, 'Client identification timeout');
        }
    }, 30000);
    
    // Send a welcome message to identify connection type
    try {
        ws.send("connection-established");
    } catch (error) {
        console.log(`Error sending welcome message: ${error.message}`);
    }

    ws.on("message", (msg) => {
        try {
            if (typeof msg === "string" || Buffer.isBuffer(msg) && msg.toString().includes('client')) {
                const message = msg.toString();
                console.log(`Received text message: ${message}`);

                if (message === "unity-client") {
                    clearTimeout(identificationTimeout);
                    console.log(`Unity client connected from ${clientIP}`);
                    unityClients.push(ws);
                    ws.clientType = "unity";
                    ws.clientIP = clientIP;
                    
                    // Send current stats to Unity client
                    try {
                        ws.send(JSON.stringify({
                            type: 'stats',
                            esp32Connected: esp32Clients.length > 0,
                            frameRate: calculateFrameRate(),
                            totalFrames: frameCount
                        }));
                    } catch (error) {
                        console.log(`Error sending stats: ${error.message}`);
                    }
                    
                } else if (message === "esp32-client") {
                    clearTimeout(identificationTimeout);
                    console.log(`ESP32 client connected from ${clientIP}`);
                    esp32Clients.push(ws);
                    ws.clientType = "esp32";
                    ws.clientIP = clientIP;
                }
            } else {
                // Binary data (JPEG from ESP32)
                if (ws.clientType !== "esp32") {
                    console.log(`Received binary data from non-ESP32 client, ignoring`);
                    return;
                }
                
                console.log(`Received frame: ${msg.length} bytes`);
                frameCount++;
                lastFrameTime = Date.now();
                
                // Clean up dead connections before forwarding
                cleanupDeadConnections();
                
                // Forward to all Unity clients
                let sentCount = 0;
                let failedCount = 0;
                
                unityClients.forEach((client, index) => {
                    if (client.readyState === WebSocket.OPEN) {
                        try {
                            client.send(msg);
                            sentCount++;
                        } catch (error) {
                            console.log(`Error sending to Unity client ${index} (${client.clientIP}):`, error.message);
                            failedCount++;
                        }
                    } else {
                        failedCount++;
                    }
                });

                if (sentCount > 0) {
                    console.log(`Frame #${frameCount} forwarded to ${sentCount} Unity clients${failedCount > 0 ? ` (${failedCount} failed)` : ''}`);
                } else if (unityClients.length > 0) {
                    console.log(`No Unity clients available to receive frame #${frameCount}`);
                }
            }
        } catch (error) {
            console.log("Error processing message:", error.message);
        }
    });

    ws.on("close", (code, reason) => {
        clearTimeout(identificationTimeout);
        console.log(`Connection closed from ${clientIP}. Code: ${code}, Reason: ${reason || 'No reason provided'}`);

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
        console.log(`WebSocket error from ${clientIP}:`, error.message);
    });

    // Send periodic ping to keep connection alive
    const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.ping();
            } catch (error) {
                console.log(`Error pinging client ${clientIP}:`, error.message);
                clearInterval(pingInterval);
            }
        } else {
            clearInterval(pingInterval);
        }
    }, 30000); // Ping every 30 seconds

    // Store interval reference for cleanup
    ws.pingInterval = pingInterval;
});

// Calculate frame rate
function calculateFrameRate() {
    const now = Date.now();
    const timeDiff = (now - (calculateFrameRate.lastCheck || now)) / 1000;
    const frameDiff = frameCount - (calculateFrameRate.lastFrameCount || 0);
    
    calculateFrameRate.lastCheck = now;
    calculateFrameRate.lastFrameCount = frameCount;
    
    return timeDiff > 0 ? (frameDiff / timeDiff).toFixed(2) : 0;
}

// Start the server
server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
    console.log(`Health check URL: http://localhost:${PORT}/`);
    console.log(`WebSocket URL: ws://localhost:${PORT}/`);
});

// Graceful shutdown
function gracefulShutdown(signal) {
    console.log(`${signal} received, shutting down gracefully`);
    
    // Close all WebSocket connections
    [...unityClients, ...esp32Clients].forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1001, 'Server shutting down');
        }
        if (client.pingInterval) {
            clearInterval(client.pingInterval);
        }
    });
    
    // Close WebSocket server
    wss.close(() => {
        console.log('WebSocket server closed');
        
        // Close HTTP server
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
        console.log('Forcefully shutting down');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Log connection status and performance metrics
setInterval(() => {
    cleanupDeadConnections();
    const frameRate = calculateFrameRate();
    console.log(`Status - Unity: ${unityClients.length}, ESP32: ${esp32Clients.length}, Frame Rate: ${frameRate} fps, Total Frames: ${frameCount}`);
}, 60000);

// Memory usage monitoring
setInterval(() => {
    const memUsage = process.memoryUsage();
    console.log(`Memory Usage - RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)}MB, Heap: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)}MB`);
}, 300000); // Every 5 minutes
