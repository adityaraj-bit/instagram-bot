import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { google } from "googleapis";
import fs from "fs";

dotenv.config();

const userLastRequest = new Map();

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const IG_USER_ID = process.env.IG_USER_ID;

/* =========================
   GOOGLE SHEETS SETUP
========================= */
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(fs.readFileSync("credentials.json")),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

const RATE_LIMIT_MINUTES = 1;

// async function isFirstTimeUser(userId) {
//   const res = await sheets.spreadsheets.values.get({
//     spreadsheetId: SPREADSHEET_ID,
//     range: "Sheet2!B2:B",
//   });

//   const users = res.data.values || [];

//   return !users.some(([id]) => id === userId);
// }

function containsCouponWord(text) {
  return /\bcoupon\b/i.test(text);
}

async function getInstagramUsername(userId) {
  try {
    const url = `https://graph.instagram.com/v21.0/${userId}?fields=username&access_token=${PAGE_ACCESS_TOKEN}`;

    const res = await axios.get(url);

    return res.data?.username || `User_${userId}`;
  } catch (err) {
    console.error("Username fetch error:", err.response?.data || err.message);
    return `User_${userId}`; // fallback
  }
}

function checkRateLimit(userId) {
  const now = Date.now();
  const lastTime = userLastRequest.get(userId);

  if (lastTime) {
    const diffMinutes = (now - lastTime) / (1000 * 60);

    if (diffMinutes < RATE_LIMIT_MINUTES) {
      return {
        allowed: false,
        wait: Math.ceil(RATE_LIMIT_MINUTES - diffMinutes),
      };
    }
  }

  // update last request time
  userLastRequest.set(userId, now);

  return { allowed: true };
}
/* =========================
   WEBHOOK VERIFICATION
========================= */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* =========================
   SEND MESSAGE (IG WORKING METHOD)
========================= */
async function sendMessage(userId, text) {
  try {
    const response = await axios.post(
      "https://graph.instagram.com/v21.0/me/messages",
      {
        recipient: { id: userId },
        message: { text },
      },
      {
        headers: {
          Authorization: `Bearer ${PAGE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ Message sent:", response.data);
  } catch (err) {
    console.error("❌ Send error:", err.response?.data || err.message);
  }
}

/* =========================
   CHECK EXISTING COUPON
========================= */
async function checkExistingCoupon(userId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A2:C",
  });

  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const [code, status, user] = rows[i];

    if (user === userId) {
      return code;
    }
  }

  return null;
}

/* =========================
   GET AVAILABLE COUPON
========================= */
async function getAvailableCoupon() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A2:C",
  });

  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const [code, status] = rows[i];

    if (status?.toLowerCase() === "available") {
      return {
        code,
        rowIndex: i + 2,
      };
    }
  }

  return null;
}

async function validateCoupon(code) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A2:C",
  });

  const rows = res.data.values || [];

  for (let i = 0; i < rows.length; i++) {
    const [coupon, status, user] = rows[i];

    if (coupon.toLowerCase() === code.toLowerCase()) {
      if (status.toLowerCase() === "assigned") {
        return `🟡 Coupon ${code} is ASSIGNED but not used`;
      }

      if (status.toLowerCase() === "used") {
        return `🔴 Coupon ${code} has been USED`;
      }
    }
  }

  return `❌ Invalid coupon code`;
}

/* =========================
   MARK COUPON USED
========================= */
async function markCouponAssigned(rowIndex, userId) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Sheet1!B${rowIndex}:C${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["Assigned", userId]],
    },
  });
}
/* =========================
   LOG MESSAGE
========================= */
async function logMessage(userId, username, message) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet2!A:D",
    valueInputOption: "RAW",
    requestBody: {
      values: [[new Date().toISOString(), userId, username, message]],
    },
  });
}

/* =========================
   ASSIGN COUPON
========================= */
async function assignCoupon(userId, username, message) {
  // check existing
  const existing = await checkExistingCoupon(userId);

  if (existing) {
    return { type: "existing", code: existing };
  }

  // get new
  const coupon = await getAvailableCoupon();

  if (!coupon) {
    return { type: "none" };
  }

  await markCouponAssigned(coupon.rowIndex, userId);
  await logMessage(userId, username, message);

  return { type: "new", code: coupon.code };
}

/* =========================
   WEBHOOK RECEIVER
========================= */
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const event = entry?.messaging?.[0];

    if (!event) return res.sendStatus(200);
    const senderId = event.sender?.id;

    // 🚨 Ignore messages sent by your own bot
    if (senderId === IG_USER_ID) {
      return res.sendStatus(200);
    }

    const userId = event.sender?.id;
    const rawText = event.message?.text;

    if (!rawText || rawText.trim() === "") {
      return res.sendStatus(200);
    }

    const text = rawText.toLowerCase();

    console.log("Incoming:", text, "from", userId);
    const username = await getInstagramUsername(userId);
    /* =========================
       FIRST TIME USER MESSAGE
    ========================= */
    // const firstTime = await isFirstTimeUser(userId);

    // let isFirst = false;

    // if (firstTime) {
    //   isFirst = true;

    //   await sendMessage(
    //     userId,
    //     "👋 Hey! Welcome!\n\n" +
    //       "You can:\n" +
    //       "🎟️ Type 'coupon' to get a discount code\n" +
    //       "🔍 Type 'check CODE' to verify a coupon\n\n" +
    //       "Go ahead and try it!",
    //   );
    // }

    /* =========================
       CHECK COUPON
    ========================= */
    if (text.startsWith("check ")) {
      const code = text.split("check ")[1].trim();
      const reply = await validateCoupon(code);

      await sendMessage(userId, reply);
      return res.sendStatus(200);
    }

    /* =========================
       COUPON KEYWORDS
    ========================= */
    const keywords = ["coupon", "#freeicecream", "#frozellecreamery"];
    const wantsCoupon = keywords.some((k) => text.includes(k));

    if (wantsCoupon) {
      const rate = checkRateLimit(userId);

      if (!rate.allowed) {
        await sendMessage(
          userId,
          `⏳ If you didn't get the coupon Please wait ${rate.wait} minutes before requesting another coupon.`,
        );
        return res.sendStatus(200);
      }

      const result = await assignCoupon(userId, username, text);

      let reply = "";

      if (result.type === "existing") {
        reply = `🎟️ You already have a coupon: ${result.code}`;
      } else if (result.type === "new") {
        reply = `🎉 Here's your coupon code: ${result.code}\nEnjoy your discount! 🛍️\nIf you want to check coupon status type 'check CODE'`;
      } else {
        reply =
          "😔 Sorry, all coupons are currently exhausted. Try again later!";
      }

      await sendMessage(userId, reply);
      return res.sendStatus(200);
    }

    /* =========================
       FALLBACK MESSAGE
    ========================= */

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
