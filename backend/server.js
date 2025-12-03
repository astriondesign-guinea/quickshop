
/**
 * QuickShop backend
 * - POST /create-payment-intent  -> { clientSecret }
 * - POST /webhook                -> Stripe webhook that inserts order into Supabase
 *
 * Notes:
 * - Use SUPABASE_SERVICE_ROLE on the server only (never expose to clients)
 * - Configure env vars (see .env.example)
 */

import express from "express";
import cors from "cors";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import bodyParser from "body-parser";

const app = express();

// ----------- ENV / CONFIG -------------
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET; // required for verifying webhook
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const GHS_RATE = parseFloat(process.env.GHS_RATE || "15"); // USD -> GHS conversion used if currency === 'ghs'
const PORT = process.env.PORT || 9999;

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY");
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-08-01" });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// Use json parser for non-webhook routes
app.use(
  cors({
    origin: true,
  })
);
app.use(express.json());

// ----- Helper: compute amount in smallest currency unit (cents) -----
function toSmallestUnit(amount, currency = "usd") {
  // amount is number in major unit (USD)
  if (currency.toLowerCase() === "ghs") {
    // convert GHS value expected? We assume client sends total in USD and requests 'ghs' if they want display only.
    // Here we treat amount as USD and convert to GHS for charging: multiply by GHS_RATE
    return Math.round(amount * GHS_RATE * 100);
  }
  return Math.round(amount * 100);
}

// ----------------- Create PaymentIntent -----------------
/**
 * Expected body:
 * {
 *   cart: [{ id, title, price, quantity?, image }],
 *   name, phone, address, email,
 *   currency: 'usd' | 'ghs'    // optional
 * }
 */
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { cart = [], name = "", phone = "", address = "", email = "", currency = "usd" } = req.body;

    if (!Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    // compute total in major currency (USD)
    const totalUSD = cart.reduce((s, i) => {
      const price = typeof i.price === "string" ? parseFloat(i.price) : i.price || 0;
      const qty = i.quantity ? Number(i.quantity) : 1;
      return s + price * qty;
    }, 0);

    // convert to smallest unit (cents or pesewas)
    const amount = toSmallestUnit(totalUSD, currency);

    // create a metadata object containing the order details (stringified)
    const metadata = {
      cart: JSON.stringify(cart),
      name: name || "",
      phone: phone || "",
      address: address || "",
      email: email || "",
      currency: currency || "usd"
    };

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: currency === "ghs" ? "ghs" : "usd",
      metadata,
      receipt_email: email || undefined,
      automatic_payment_methods: { enabled: true }
    });

    return res.json({ clientSecret: paymentIntent.client_secret, paymentIntentId: paymentIntent.id });
  } catch (err) {
    console.error("create-payment-intent error:", err);
    return res.status(500).json({ error: (err && err.message) || "Server error" });
  }
});

// ----------------- Stripe webhook (verify raw body) -----------------
// Stripe requires the raw body to verify signature. We'll use express.raw for this route.
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    if (!STRIPE_WEBHOOK_SECRET) {
      console.warn("STRIPE_WEBHOOK_SECRET not configured - skipping signature verification (not recommended for production)");
      // If not configured, parse body and process (less secure)
      try {
        event = JSON.parse(req.body.toString());
      } catch (e) {
        console.error("Webhook JSON parse error", e);
        return res.status(400).send(`Webhook error: ${e.message}`);
      }
    } else {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error("Webhook signature mismatch.", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    }

    // Handle the event
    try {
      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object;
        console.log("PaymentIntent succeeded:", paymentIntent.id);

        // metadata contains our order data
        const meta = paymentIntent.metadata || {};
        const cart = meta.cart ? JSON.parse(meta.cart) : [];
        const name = meta.name || "";
        const phone = meta.phone || "";
        const address = meta.address || "";
        const userEmail = meta.email || "guest";
        const currency = meta.currency || "usd";

        // compute total in major unit from paymentIntent.amount (smallest unit)
        const amountSmallest = paymentIntent.amount;
        // Convert back to major unit (USD) - rough conversion (we used toSmallestUnit)
        let totalMajor = amountSmallest / 100;
        if (currency === "ghs") {
          totalMajor = (amountSmallest / 100) / GHS_RATE;
        }

        // Avoid duplicate inserts: store stripe_payment_intent
        const stripe_id = paymentIntent.id;

        // Insert order into Supabase (service role)
        const { data, error } = await supabase.from("orders").insert([
          {
            user_email: userEmail,
            items: cart,
            total: totalMajor,
            name,
            phone,
            address,
            status: "paid",
            stripe_payment_intent: stripe_id
          }
        ]);

        if (error) {
          console.error("Supabase insert error:", error);
          // don't fail webhook; log and continue
        } else {
          console.log("Order saved to Supabase:", data && data[0] && data[0].id);
        }
      } else {
        // handle other relevant events if you like
        // console.log(`Unhandled event type ${event.type}`);
      }

      // Return a response to acknowledge receipt of the event
      res.json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err);
      res.status(500).send("Webhook handler error");
    }
  }
);

// a lightweight health-check
app.get("/", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

// start
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
