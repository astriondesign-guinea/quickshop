import express from "express";
import Stripe from "stripe";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// --------------------------------------
// STRIPE INITIALIZATION WITH YOUR KEY
// --------------------------------------
const stripe = new Stripe("sk_test_51Sa4yzJmuEW2Dbb0tnhhsvD2Jx1qHfZWcg2CZdtSsB50aaFG1rIMGoUW8EFpFJXdBAoTCWJrUAYwowtfUTdvxqC900Edjnkcz3");

// ROOT TEST
app.get("/", (req, res) => {
  res.send("QuickShop Payments API is running ✔");
});

// --------------------------------------
// CREATE PAYMENT INTENT
// --------------------------------------
app.post("/create-payment-intent", async (req, res) => {
  try {
    const { amount, currency } = req.body;

    if (!amount || !currency) {
      return res.status(400).json({ error: "Missing amount or currency" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true }
    });

    res.json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --------------------------------------
// SERVER LISTEN
// --------------------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
