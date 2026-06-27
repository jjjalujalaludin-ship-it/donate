const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const cors = require("cors");
const WebSocket = require("ws");

const fs = require("fs");
const path = require("path");
const CONFIG_FILE =
  path.join(__dirname, "config.json");

function loadConfig() {

  try {

    if (!fs.existsSync(CONFIG_FILE)) {

      fs.writeFileSync(
        CONFIG_FILE,
        JSON.stringify({
          orderkuota: {
            username: "",
            token: ""
          }
        }, null, 2)
      );

    }

    return JSON.parse(
      fs.readFileSync(
        CONFIG_FILE,
        "utf8"
      )
    );

  } catch {

    return {
      orderkuota: {
        username: "",
        token: ""
      }
    };

  }

}

let config = loadConfig();

let ORDERKUOTA_USERNAME =
  config.orderkuota.username || "";

let ORDERKUOTA_TOKEN =
  config.orderkuota.token || "";
  
require("dotenv").config();



function saveOrderKuotaConfig(
  username,
  token
){

  config.orderkuota = {

    username,
    token

  };

  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(
      config,
      null,
      2
    )
  );

  ORDERKUOTA_USERNAME =
    username;

  ORDERKUOTA_TOKEN =
    token;

}
const DB_FILE = path.join(__dirname, "donations.json");

// ===============================
// EVENT QUEUE
// ===============================

const QUEUE_FILE = path.join(__dirname, "queue.json");

let eventQueue = [];

if (fs.existsSync(QUEUE_FILE)) {

    try {

        eventQueue = JSON.parse(
            fs.readFileSync(
                QUEUE_FILE,
                "utf8"
            )
        );

    } catch {

        eventQueue = [];

    }

}

function saveQueue(){

    fs.writeFileSync(
        QUEUE_FILE,
        JSON.stringify(
            eventQueue,
            null,
            2
        )
    );

}

function enqueueEvent(payload){

    const trx = String(payload.trx);

    // kalau sudah ada jangan tambah lagi
    if(eventQueue.some(e => e.trx === trx)){
        return;
    }

    eventQueue.push({

        trx,

        payload,

        state: "pending",

        lastSend: 0,

        retry: 0,

        created_at: Date.now()

    });

    saveQueue();

    console.log("[QUEUE] ADD", trx);

    // langsung coba kirim
    dispatchQueue();

}

function removeQueue(trx){

    const before =
        eventQueue.length;

    eventQueue =
        eventQueue.filter(
            e=>e.trx!==String(trx)
        );

    if(before!==eventQueue.length){

        saveQueue();

        console.log(
            "[QUEUE] REMOVE",
            trx
        );

    }

}

function dispatchQueue(){

    if(eventQueue.length === 0)
        return;

    for(const item of eventQueue){

        if(item.state !== "pending")
            continue;

        const json = JSON.stringify(item.payload);

        let sent = false;

        for(const ws of wsClients){

            if(
                ws.readyState !== WebSocket.OPEN ||
                !ws.ready
            ){
                continue;
            }

            try{

                ws.send(json);

                sent = true;

            }catch{}

        }

        if(sent){

            item.state = "waiting_ack";

            item.lastSend = Date.now();

            item.retry++;
			
			saveQueue();

            console.log(
                "[QUEUE] SEND",
                item.trx
            );

        }

    }

    saveQueue();

}


const app = express();
const server = http.createServer(app);
const io = new Server(server);
// ===============================
// HUB WS SERVER
// ===============================

const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

const wsClients = new Set();

wss.on("connection", (ws, req) => {

  console.log(
    "🔌 WS Connected:",
    req.socket.remoteAddress
  );

  ws.isAlive = true;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  wsClients.add(ws);

  ws.on("message", raw => {

    try {

      const msg =
        JSON.parse(raw.toString());

if(msg.type === "hello"){

    ws.lastTrx =
        msg.lastTrx || null;

    ws.clientId =
        msg.clientId || "default";

    ws.ready = true;

// reset event yg belum sempat ACK
for(const item of eventQueue){

    if(item.state==="waiting_ack"){

        item.state="pending";

    }

}

saveQueue();

dispatchQueue();

    console.log(
        "👋 HELLO",
        ws.clientId,
        ws.lastTrx
    );

}

if(msg.type === "watch_payment"){

    ws.paymentId = String(msg.id);

    console.log(
      "👀 WATCH PAYMENT:",
      ws.paymentId
    );

}

if(msg.type === "ack"){

    console.log(
        "✅ ACK:",
        msg.trx
    );

    removeQueue(msg.trx);

}

    } catch {}

  });

  ws.on("close", () => {

    wsClients.delete(ws);

    console.log(
      "❌ WS Disconnected"
    );

  });

});



setInterval(() => {

  for(const ws of wsClients){

    if(ws.isAlive === false){

      ws.terminate();

      wsClients.delete(ws);

      continue;

    }

    ws.isAlive = false;

    ws.ping();

  }

},15000);

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const {
  OrderKuota,
  createQRIS: createDynamicQRIS
} = require("./lib/orderkuota-client");

const customAdapter =
    require("./adapters/custom");
	
const sociabuzzAdapter =
    require("./adapters/sociabuzz");


// ===============================
// 🔥 HUB CONFIG (FIX NON BLOCKING)
// ===============================

function sendToHub(d) {

  try {

    const payload = {

    type: "notification",

    trx: String(d.id),

    user: d.name || "SESEORANG",

    title: "Donasi Masuk",

    pesan: d.message || "",

    amount: Number(d.amount_original),

    time: new Date().toISOString()

};

// Simpan ke queue.
// Queue Worker yang akan mengirim.
enqueueEvent(payload);

console.log(
    "📥 Queue:",
    payload.trx
);

  } catch(err){

    console.log(
      "❌ WS ERROR:",
      err.message
    );

  }

}

/* ========================= */
/* 🔥 STORAGE */

let donations = [];
let pendingDonations = [];

if (fs.existsSync(DB_FILE)) {
  try {
    donations = JSON.parse(fs.readFileSync(DB_FILE));
    console.log("📂 Data loaded:", donations.length);
  } catch {}
}

function saveDonations() {
  fs.writeFileSync(DB_FILE, JSON.stringify(donations, null, 2));
}

/* ========================= */

function generateUniqueAmount(base) {
  let unique;
  let amount;
  do {
    unique = Math.floor(Math.random() * 90) + 10; // 🔥 2 digit (10–99)
    amount = Number(base) + unique;
  } while (donations.some(d => d.amount_unique === amount));
  return amount;
}

/* ========================= */

async function createQRIS(amount) {

  const ok =
  new OrderKuota(
    ORDERKUOTA_USERNAME,
    ORDERKUOTA_TOKEN
  );

  const qrisData =
    await ok.generateQr(amount);

  if (!qrisData?.qris_data) {
    throw new Error(
      "QRIS generation failed"
    );
  }

  const result =
    await createDynamicQRIS(
      amount,
      qrisData.qris_data
    );

  return {
    image:
      result.imageqris.url
  };
}

async function getMutasi() {

  try {

    const ok =
  new OrderKuota(
    ORDERKUOTA_USERNAME,
    ORDERKUOTA_TOKEN
  );

    const result =
      await ok.getTransactionQris();

    return (
      result?.qris_history?.results ||
      []
    );

  } catch (err) {

    console.log(
      "❌ error mutasi:",
      err.message
    );

    return [];
  }
}

function emitOverlay(d) {

  if (d.media_url && String(d.media_url).trim() !== "") {

    io.emit("donation_media", d);

  } else {

    io.emit("donation", d);

  }

}

function emitDashboard() {

  io.emit("dashboard_update");

}

function emitInteractive(d) {

  setTimeout(() => sendToHub(d), 0);

}

function handleDonation(d, options = {}) {

  const {

    interactive = true,

    overlay = true,

    dashboard = true

  } = options;
  
  // Default metadata
if (!d.source) {
  d.source = "unknown";
}

if (!d.platform) {
  d.platform = "unknown";
}

  donations.push(d);

  if (donations.length > 1000) {

    donations = donations.slice(-1000);

  }

  saveDonations();

  if (interactive) {

    emitInteractive(d);

  }

  if (overlay) {

    emitOverlay(d);

  }

  if (dashboard) {

    emitDashboard();

  }

  return d;

}

/* ========================= */
/* 🔥 AUTO LOOP */

let checking = false;

async function checkMutasiLoop() {
  if (checking) return;
  checking = true;

  const interval = setInterval(async () => {

    if (pendingDonations.length === 0) {
      clearInterval(interval);
      checking = false;
      return;
    }

    const mutasi = await getMutasi();

    for (let trx of mutasi) {
      if (trx.status !== "IN") continue;

      const amount = Number(String(trx.kredit).replace(/\./g, ""));

      for (let d of [...pendingDonations]) {

        if (Date.now() - d.created_at > 2 * 60 * 1000) {
          console.log("⏰ expired:", d.id);
          pendingDonations = pendingDonations.filter(x => x.id !== d.id);
          continue;
        }

        if (amount === Number(d.amount_unique)) {

          d.status = "paid";

          if (d.amount_original < 10000) d.media_url = "";
          d.video_duration = Math.floor(d.amount_original / 200);

          const now = new Date();

          d.tanggal = now.toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric"
          });

          d.jam = now.toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit"
          });

          d.created_at = Date.now();

          // Simpan data yang sudah dibayar
d.status = "paid";

pendingDonations =
  pendingDonations.filter(x => x.id !== d.id);

console.log("💰 PAID:", d.amount_unique);

// ===============================
// PAYMENT PAID WS
// ===============================

for (const ws of wsClients) {

  if (
    ws.readyState === WebSocket.OPEN &&
    String(ws.paymentId) === String(d.id)
  ) {

    ws.send(JSON.stringify({
      type: "payment_paid",
      id: d.id
    }));

  }

}

// ===============================
// HANDLE DONATION
// ===============================

handleDonation({

  id: d.id,
  
  source: "orderkuota",

  platform: "qris",

  name: d.name,

  message: d.message,

  media_url: d.media_url,

  amount_original: d.amount_original,

  amount_unique: d.amount_unique,

  video_duration: d.video_duration,

  tanggal: d.tanggal,

  jam: d.jam,

  created_at: d.created_at

});
        }
      }
    }

  }, 5000);
}

/* ========================= */
/* 🔥 DONATE */

app.post("/donate", async (req, res) => {
  const { name, amount, message, media_url } = req.body;

  const amount_unique = generateUniqueAmount(amount);
  const qris = await createQRIS(amount_unique);

  const donation = {

  id: Date.now(),

  source: "orderkuota",

  platform: "qris",

  name,

  message,

  media_url,

  amount_original: Number(amount),

  amount_unique,

  qr: qris.image,

  status: "pending",

  created_at: Date.now()

};

  pendingDonations.push(donation);
  checkMutasiLoop();

  res.json(donation);
});

// =========================
// 🧪 TEST DONATE (PATCH 1)
// =========================

app.post("/test-donate", (req, res) => {

  const { name, amount, message, media_url } = req.body;

  const d = {

    id: Date.now(),
	
	source: "test",

    platform: "internal",

    name: name || "TEST USER",

    message: message || "Test donation 🚀",

    media_url: media_url || "",

    amount_original: Number(amount || 10000),

    amount_unique: Number(amount || 10000),

    video_duration: Math.floor((amount || 10000) / 200),

    tanggal: new Date().toLocaleDateString("id-ID"),

    jam: new Date().toLocaleTimeString("id-ID"),

    created_at: Date.now()

  };

  console.log("🧪 TEST DONATION:", d.amount_original);

  handleDonation(d);

  res.json({

    success: true,

    data: d

  });

});

/* ========================= */

app.get("/donation/:id", (req, res) => {
  const d =
    pendingDonations.find(x => x.id == req.params.id) ||
    donations.find(x => x.id == req.params.id);

  res.json(d || {});
});

/* ========================= */

app.get("/check/:id", (req, res) => {
  const id = req.params.id;

  const pending = pendingDonations.find(x => x.id == id);
  if (pending) return res.json({ status: "pending" });

  const paid = donations.find(x => x.id == id);
  if (paid) return res.json({ status: "paid" });

  return res.json({ status: "expired" });
});

/* ========================= */

app.get("/donations", (req, res) => {
  res.json([...donations].reverse());
});

// 🔥 DASHBOARD DATA
app.get("/dashboard", (req, res) => {

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthly = donations.filter(d => {
    const date = new Date(d.created_at);
    return date.getMonth() === currentMonth &&
           date.getFullYear() === currentYear;
  });

  const total = monthly.reduce((sum, d) => {
    return sum + Number(d.amount_original || 0);
  }, 0);

  const leaderboardMap = {};

  monthly.forEach(d => {
    if (!leaderboardMap[d.name]) {
      leaderboardMap[d.name] = 0;
    }
    leaderboardMap[d.name] += Number(d.amount_original || 0);
  });

  const leaderboard = Object.entries(leaderboardMap)
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  res.json({
    total,
    leaderboard
  });
});

// 🔥 DASHBOARD DETAIL
app.get("/dashboard-detail", (req, res) => {

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthly = donations.filter(d => {
    const date = new Date(d.created_at);
    return date.getMonth() === currentMonth &&
           date.getFullYear() === currentYear;
  });

  const total = monthly.reduce((sum, d) => sum + Number(d.amount_original || 0), 0);

  const map = {};
  monthly.forEach(d => {
    map[d.name] = (map[d.name] || 0) + Number(d.amount_original || 0);
  });

  const leaderboard = Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a,b)=>b.total-a.total)
    .slice(0,10);

  const dailyMap = {};
  monthly.forEach(d => {
    const day = new Date(d.created_at).getDate();
    dailyMap[day] = (dailyMap[day] || 0) + Number(d.amount_original || 0);
  });

  const chart = Object.entries(dailyMap)
    .map(([day, total]) => ({ day, total }))
    .sort((a,b)=>a.day-b.day);

  res.json({ total, leaderboard, chart });
});

/* ========================= */

app.post("/replay/:id", (req, res) => {

  const d = donations.find(x => x.id == req.params.id);

  if (!d) {
    return res.status(404).json({
      error: "not found"
    });
  }

  emitOverlay(d);

  res.json({
    success: true
  });

});

/* ========================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("🚀 Server jalan di port", PORT);
});

io.on("connection", (socket) => {
  socket.on("donation", (data) => {
    io.emit("donation", data);
  });
});

/* ========================== */

app.get("/leaderboard", (req, res) => {

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const monthly = donations.filter(d => {
    const date = new Date(d.created_at);
    return date.getMonth() === currentMonth &&
           date.getFullYear() === currentYear;
  });

  const map = {};
  monthly.forEach(d => {
    map[d.name] = (map[d.name] || 0) + Number(d.amount_original || 0);
  });

  const leaderboard = Object.entries(map)
    .map(([name, total]) => ({ name, total }))
    .sort((a,b)=>b.total-a.total)
    .slice(0,10);

  res.json(leaderboard);
});

app.get("/orderkuota/getotp", async (req, res) => {

  const { username, password } = req.query;

  try {

    const ok = new OrderKuota();

    const result =
      await ok.loginRequest(
        username,
        password
      );

    res.json(result);

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});

app.get("/orderkuota/gettoken", async (req, res) => {

  const { username, otp } = req.query;

  try {

    const ok = new OrderKuota();

    const result =
      await ok.getAuthToken(
        username,
        otp
      );

    res.json(result);

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});



app.post("/orderkuota/save-token", (req, res) => {

  const { username, token } = req.body;

  if (!username || !token) {
    return res.status(400).json({
      success: false,
      message: "username/token kosong"
    });
  }

  saveOrderKuotaConfig(
    username,
    token
  );

  res.json({
    success: true,
    username,
    token,
    message: "Username & Token tersimpan ke .env"
  });

});

app.get("/orderkuota/config", (req, res) => {

  res.json({
    username: ORDERKUOTA_USERNAME,
    token: ORDERKUOTA_TOKEN
      ? "********"
      : ""
  });

});

app.get("/orderkuota/profile", async (req, res) => {

  try {

    const ok = new OrderKuota(
      ORDERKUOTA_USERNAME,
      ORDERKUOTA_TOKEN
    );

    const result =
      await ok.getTransactionQris();

    res.json(result);

  } catch(err) {

    res.status(500).json({
      error: err.message
    });

  }

});

app.get("/orderkuota/mutasi", async (req, res) => {

  try {

    const ok = new OrderKuota(
      ORDERKUOTA_USERNAME,
      ORDERKUOTA_TOKEN
    );

    const result =
      await ok.getTransactionQris();

    res.json(
      result.qris_history?.results || []
    );

  } catch(err) {

    res.status(500).json({
      error: err.message
    });

  }

});

app.post("/orderkuota/createpayment", async (req, res) => {

  try {

    const { amount } = req.body;

    const ok = new OrderKuota(
      ORDERKUOTA_USERNAME,
      ORDERKUOTA_TOKEN
    );

    const qrData =
      await ok.generateQr(amount);

    if (!qrData?.qris_data) {
      return res.status(400).json({
        success: false,
        message: "QRIS gagal dibuat"
      });
    }

    const result =
      await createDynamicQRIS(
        amount,
        qrData.qris_data
      );

    res.json({
      success: true,
      data: result
    });

  } catch (err) {

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});

app.get("/ws-status",(req,res)=>{

  res.json({

    clients:
      wsClients.size

  });

});

const BROADCAST_TOKEN =
  process.env.BROADCAST_TOKEN ||
  "EI115256152";
  
const SOCIABUZZ_TOKEN =
  process.env.SOCIABUZZ_TOKEN ||
  "";

function broadcastEvent(payload){

    enqueueEvent(payload);

    return wsClients.size;

}

app.post("/broadcast", (req, res) => {

  try {

    const token = req.headers["x-broadcast-token"];

    if (token !== BROADCAST_TOKEN) {

      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });

    }

    const {
      trx,
      user,
      title,
      pesan,
      amount,
      time
    } = req.body || {};

    if (!trx) {

      return res.status(400).json({
        success: false,
        error: "missing trx"
      });

    }

    // ===============================
    // PAYLOAD UNTUK ELIANA INTERACTIVE
    // ===============================

    const payload = {

      type: "notification",

      trx,

      user,

      title,

      pesan,

      amount,

      time

    };

    // ===============================
    // DONATION OBJECT
    // ===============================

    const donation =
    customAdapter(req.body);

    // ===============================
    // HANDLE DONATION
    // ===============================

    handleDonation(donation, {

    interactive: false

    });

    // ===============================
    // WEBSOCKET CLIENT (ELIANA INTERACTIVE)
    // ===============================

    const sent = broadcastEvent(payload);

    console.log(
      "[HUB] notify broadcast:",
      trx,
      "->",
      sent,
      "WS client(s)"
    );

    console.log(
      "[OVERLAY] donation emitted:",
      user,
      amount
    );

    res.json({
      ok: true,
      sent
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});


app.get(
  "/orderkuota/current",
  (req,res)=>{

    res.json({

      username:
        ORDERKUOTA_USERNAME,

      tokenLength:
        ORDERKUOTA_TOKEN.length

    });

  }
);

const googleTTS = require("google-tts-api");
const axios = require("axios");

app.get("/tts", async (req, res) => {
    try {
        const text = req.query.text;

        if (!text) {
            return res.status(400).send("Missing text");
        }

        const url = googleTTS.getAudioUrl(text, {
            lang: "id",
            slow: false,
            host: "https://translate.google.com",
        });

        const response = await axios.get(url, {
    responseType: "stream",
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137 Safari/537.36",
        "Accept": "audio/mpeg,*/*",
        "Referer": "https://translate.google.com/",
    },
    maxRedirects: 5
});

res.setHeader("Content-Type", "audio/mpeg");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Access-Control-Allow-Origin", "*");

response.data.pipe(res);

    } catch (err) {
        console.error(err);
        res.sendStatus(500);
    }
});

app.post("/webhook/custom", (req, res) => {

  try {

    // ===============================
    // AUTH
    // ===============================

    const token = req.headers["x-webhook-token"];

    if (token !== BROADCAST_TOKEN) {

      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });

    }

    // ===============================
    // PARSE
    // ===============================

    const donation = customAdapter(req.body);

    // ===============================
    // VALIDASI
    // ===============================

    if (
      !donation.name ||
      Number(donation.amount_original) <= 0
    ) {

      return res.status(400).json({
        success: false,
        error: "Invalid donation"
      });

    }

    // ===============================
    // HANDLE DONATION
    // ===============================

    handleDonation(donation);

    res.json({

      success: true,

      data: donation

    });

  } catch (err) {

    console.error(err);

    res.status(500).json({

      success: false,

      error: err.message

    });

  }

});

// ===============================
// WEBHOOK SOCIABUZZ
// ===============================

app.post("/webhook/sociabuzz", (req, res) => {

  try {

    // ===============================
    // VALIDASI TOKEN
    // ===============================

    const token =
      req.headers["sb-webhook-token"] ||
      req.headers["x-webhook-token"] ||
      "";

    if (token !== SOCIABUZZ_TOKEN) {

      return res.status(401).json({
        success: false,
        error: "Unauthorized"
      });

    }

    // ===============================
    // PARSE DONATION
    // ===============================

    const donation = sociabuzzAdapter(req.body);

    // ===============================
    // DEBUG (boleh dihapus nanti)
    // ===============================

    global.lastSociabuzz = {
      headers: req.headers,
      body: req.body,
      donation
    };

    // ===============================
    // VALIDASI DONATION
    // ===============================

    if (
      !donation.name ||
      donation.amount_original <= 0
    ) {

      return res.status(400).json({
        success: false,
        error: "Invalid donation"
      });

    }

    // ===============================
    // HANDLE DONATION
    // ===============================

    handleDonation(donation);

    console.log(
      "[Sociabuzz]",
      donation.name,
      donation.amount_original
    );

    res.json({
      success: true,
      data: donation
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      error: err.message
    });

  }

});

app.get("/debug/sociabuzz", (req, res) => {
  res.json(global.lastSociabuzz || {});
});