const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;
const wss = new WebSocket.Server({ port: PORT });

let unityClients = [];

wss.on("connection", ws => {
  console.log("New connection");

  ws.on("message", msg => {
    if (typeof msg === "string" && msg === "unity-client") {
      console.log("Unity client connected");
      unityClients.push(ws);
    } else {
      // Assume msg is a JPEG buffer from ESP32
      unityClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      });
    }
  });

  ws.on("close", () => {
    unityClients = unityClients.filter(c => c !== ws);
  });
});
