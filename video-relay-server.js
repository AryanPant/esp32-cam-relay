const WebSocket = require("ws");
const http = require("http");
const PORT = process.env.PORT || 10000;

// Create HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket Server Running\n');
});

// Create WebSocket server
const wss = new WebSocket.Server({ 
    server: server,
    perMessageDeflate: false
});

let clients = [];

console.log(`Starting WebSocket server on port ${PORT}`);

wss.on("connection", (ws) => {
    console.log("New client connected");
    clients.push(ws);
    
    ws.on("message", (data) => {
        console.log(`Received data: ${data.length} bytes`);
        
        // Forward to all other clients (excluding sender)
        let sentCount = 0;
        clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                try {
                    client.send(data);
                    sentCount++;
                } catch (error) {
                    console.log("Error sending data:", error.message);
                }
            }
        });
        
        console.log(`Forwarded to ${sentCount} clients`);
    });

    ws.on("close", () => {
        console.log("Client disconnected");
        clients = clients.filter(client => client !== ws);
    });

    ws.on("error", (error) => {
        console.log("WebSocket error:", error.message);
        clients = clients.filter(client => client !== ws);
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`WebSocket server listening on port ${PORT}`);
});

// Clean up dead connections every 30 seconds
setInterval(() => {
    clients = clients.filter(client => client.readyState === WebSocket.OPEN);
    console.log(`Active clients: ${clients.length}`);
}, 30000);
