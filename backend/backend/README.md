# QuickShop backend (Stripe + Supabase)

## 1) Add files
Place `server.js`, `package.json`, `.env.example` in `backend/` and push to GitHub.

## 2) Deploy on Render
- Create New → Web Service → Connect repo → choose `backend/` folder
- Build Command: `npm install`
- Start Command: `npm start`
- Add environment variables in Render dashboard (see `.env.example`):
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `GHS_RATE`

## 3) Configure Stripe
- In Stripe Dashboard → Developers → Webhooks → Add endpoint:
  - URL: `https://YOUR-RENDER-SERVICE/rendered-domain/webhook`
  - Events: `payment_intent.succeeded` (and any you want)
- Copy the Webhook secret into `STRIPE_WEBHOOK_SECRET` on Render.

## 4) Client usage
- Client calls: `POST /create-payment-intent` with:
  ```json
  {
    "cart": [{ "id": "...", "title":"...", "price": 50, "quantity": 1, "image":"..." }],
    "name":"Customer",
    "phone":"123",
    "address":"Street",
    "email":"customer@example.com",
    "currency":"usd" // or "ghs"
  }
