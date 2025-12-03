/**
 * server.js
 * Node/Express backend to orchestrate Orange & MTN Mobile Money payments
 *
 * IMPORTANT: fill env vars below before running:
 *
 *   PORT=3000
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...   (Supabase service_role key - keep secret)
 *
 *   ORANGE_API_BASE=https://api.orange.com  (example)
 *   ORANGE_CLIENT_ID=...
 *   ORANGE_CLIENT_SECRET=...
 *   ORANGE_PROVIDER_ID=... (merchant id)
 *
 *   MTN_API_BASE=https://api.mtn.com (example)
 *   MTN_API_KEY=...
 *   MTN_SUBSCRIPTION_KEY=...
 *
 * This is a template. Provider request payloads will vary — consult provider docs and adapt.
 */

import express from 'express'
import fetch from 'node-fetch'
import bodyParser from 'body-parser'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const app = express()
app.use(bodyParser.json())

// ENV
const PORT = process.env.PORT || 3000
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // service role needed to write protected tables
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const ORANGE_API_BASE = process.env.ORANGE_API_BASE || 'https://api.orange.com'
const ORANGE_CLIENT_ID = process.env.ORANGE_CLIENT_ID || ''
const ORANGE_CLIENT_SECRET = process.env.ORANGE_CLIENT_SECRET || ''
const ORANGE_PROVIDER_ID = process.env.ORANGE_PROVIDER_ID || '' // merchant id

const MTN_API_BASE = process.env.MTN_API_BASE || 'https://proxy.mtn.com' // example
const MTN_API_KEY = process.env.MTN_API_KEY || ''
const MTN_SUBSCRIPTION_KEY = process.env.MTN_SUBSCRIPTION_KEY || ''

// Helper to create unique payment id
function makeId(){ return 'pay_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex') }

// Create payment record in Supabase (status: pending)
async function createPaymentRecord({ payment_id, provider, amount, phone, name, items, rawProviderData }){
  const { data, error } = await supabase
    .from('payments')
    .insert([{
      payment_id,
      provider,
      amount,
      phone,
      customer_name: name,
      items,
      status: 'pending',
      provider_data: rawProviderData || null
    }])
    .select()
  if(error) throw error
  return data && data[0]
}

/**
 * POST /api/create-payment/orange
 * body: { amount, phone, name, items }
 *
 * This example uses a simple pattern:
 *  - call Orange payment API (you must adapt to provider docs)
 *  - store outgoing provider request info in payments row
 *  - return payment_id to client
 */
app.post('/api/create-payment/orange', async (req, res) => {
  try{
    const { amount, phone, name, items } = req.body
    if(!amount || !phone) return res.status(400).json({ error:'amount and phone required' })
    const payment_id = makeId()

    // Example: create provider request payload (you must adapt to Orange's real API)
    const providerPayload = {
      merchant: ORANGE_PROVIDER_ID,
      amount: amount,
      currency: 'GNF', // or provider currency (check with provider)
      phone: phone,
      externalId: payment_id,
      description: `QuickShop order ${payment_id}`
    }

    // OPTIONAL: call Orange API here to initiate the payment (depends on provider)
    // Example: (this is pseudo; see provider docs)
    // const providerResp = await fetch(`${ORANGE_API_BASE}/v1/payments`, { method:'POST', headers:{...}, body: JSON.stringify(providerPayload) })
    // const provJson = await providerResp.json()

    const provJson = { simulated: true, note: 'You must replace with real Orange API call' }

    // Save record to Supabase
    const rec = await createPaymentRecord({
      payment_id, provider: 'orange', amount, phone, name, items, rawProviderData: provJson
    })

    return res.json({ paymentId: payment_id, status: 'pending', message:'Payment created (simulated).', nextAction: { instructions: 'User will receive a prompt on their Orange Money app / phone to accept payment. Check the status here.' } })
  }catch(err){
    console.error('orange create error', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
})

/**
 * POST /api/create-payment/mtn
 * body: { amount, phone, name, items }
 */
app.post('/api/create-payment/mtn', async (req, res) => {
  try{
    const { amount, phone, name, items } = req.body
    if(!amount || !phone) return res.status(400).json({ error:'amount and phone required' })
    const payment_id = makeId()

    // Provider payload (pseudo)
    const providerPayload = { amount, phone, externalId: payment_id, currency: 'GNF', description:`QuickShop ${payment_id}` }

    // TODO: call MTN API per their docs
    const provJson = { simulated: true, note: 'Replace with real MTN API call' }

    const rec = await createPaymentRecord({
      payment_id, provider: 'mtn', amount, phone, name, items, rawProviderData: provJson
    })

    return res.json({ paymentId: payment_id, status:'pending', message:'MTN payment created (simulated).', nextAction: { instructions: 'User will receive a prompt on their MTN MoMo to accept payment. Check status here.' } })
  }catch(err){
    console.error('mtn create error', err)
    return res.status(500).json({ error: err.message || String(err) })
  }
})

/**
 * GET /api/payment-status/:paymentId
 * returns payment row from Supabase
 */
app.get('/api/payment-status/:paymentId', async (req, res) => {
  try{
    const paymentId = req.params.paymentId
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_id', paymentId)
      .limit(1)
    if(error) return res.status(500).json({ error: error.message })
    if(!data || data.length===0) return res.status(404).json({ error: 'not found' })
    const p = data[0]
    res.json({ status: p.status, payment: p, message: p.provider_message || null })
  }catch(err){
    res.status(500).json({ error: err.message })
  }
})

/**
 * Webhooks that providers call to update payment status.
 * You'll configure these URLs in their merchant dashboard
 */
app.post('/webhook/orange', async (req, res) => {
  // Validate webhook signature per provider docs; omitted here
  try{
    const body = req.body
    // body should contain externalId/payment id and status
    const paymentId = body.externalId || body.payment_id || body.reference
    const status = (body.status || body.result || 'pending').toLowerCase()
    const provider_message = body

    if(!paymentId) return res.status(400).send('missing id')

    await supabase.from('payments').update({ status, provider_data: provider_message }).eq('payment_id', paymentId)
    // Optionally also insert a record into orders table when paid
    if(status === 'paid' || status === 'success' || status === 'completed'){
      // create order record (example)
      const p = (await supabase.from('payments').select('*').eq('payment_id', paymentId).limit(1)).data?.[0]
      if(p){
        await supabase.from('orders').insert([{
          user_email: p.phone || 'guest',
          items: p.items,
          total: p.amount,
          name: p.customer_name || '',
          address: 'Mobile money',
          status: 'pending'
        }])
      }
    }
    res.send('ok')
  }catch(err){
    console.error('webhook orange', err)
    res.status(500).send('err')
  }
})

app.post('/webhook/mtn', async (req, res) => {
  try{
    const body = req.body
    const paymentId = body.externalId || body.payment_id || body.reference
    const status = (body.status || body.result || 'pending').toLowerCase()
    const provider_message = body
    if(!paymentId) return res.status(400).send('missing id')
    await supabase.from('payments').update({ status, provider_data: provider_message }).eq('payment_id', paymentId)
    if(status === 'paid' || status === 'success' || status === 'completed'){
      const p = (await supabase.from('payments').select('*').eq('payment_id', paymentId).limit(1)).data?.[0]
      if(p){
        await supabase.from('orders').insert([{
          user_email: p.phone || 'guest',
          items: p.items,
          total: p.amount,
          name: p.customer_name || '',
          address: 'Mobile money',
          status: 'pending'
        }])
      }
    }
    res.send('ok')
  }catch(err){
    console.error('webhook mtn', err)
    res.status(500).send('err')
  }
})

app.listen(PORT, ()=> console.log(`Server running on ${PORT}`))
