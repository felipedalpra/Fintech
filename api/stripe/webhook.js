import { getStripe, readRawBody, findBillingAccountByStripeCustomer, upsertBillingAccount } from './_lib.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

const BLOCKED = new Set(['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'])

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return res.status(503).json({ error:'STRIPE_WEBHOOK_SECRET not configured' })
  }

  try {
    const stripe = getStripe()
    const rawBody = await readRawBody(req)
    const signature = req.headers['stripe-signature']
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object)
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionChanged(event.data.object)
        break
      case 'invoice.paid':
      case 'invoice.payment_failed':
        await handleInvoiceEvent(event.data.object)
        break
      default:
        break
    }

    return res.status(200).json({ received:true })
  } catch (error) {
    return res.status(400).json({ error:error.message || 'Webhook error' })
  }
}

async function handleCheckoutCompleted(session) {
  const userId = session.client_reference_id || session.metadata?.user_id
  if (!userId) return

  await upsertBillingAccount(userId, {
    stripe_customer_id:session.customer || null,
    stripe_checkout_session_id:session.id,
  })
}

async function handleSubscriptionChanged(subscription) {
  const userId = subscription.metadata?.user_id || (await findBillingAccountByStripeCustomer(subscription.customer))?.user_id
  if (!userId) return

  const status = normalizeStatus(subscription.status)
  const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null
  const accessExpiresAt = BLOCKED.has(status)
    ? new Date().toISOString()
    : currentPeriodEnd

  await upsertBillingAccount(userId, {
    status,
    selected_plan:subscription.metadata?.plan_id || undefined,
    stripe_customer_id:subscription.customer || null,
    stripe_subscription_id:subscription.id,
    current_period_end:currentPeriodEnd,
    access_expires_at:accessExpiresAt,
    stripe_price_id:subscription.items?.data?.[0]?.price?.id || null,
    last_event_at:new Date().toISOString(),
  })
}

async function handleInvoiceEvent(invoice) {
  const billing = await findBillingAccountByStripeCustomer(invoice.customer)
  if (!billing?.user_id) return

  const paid = invoice.status === 'paid'
  const periodEnd = invoice.lines?.data?.[0]?.period?.end ? new Date(invoice.lines.data[0].period.end * 1000).toISOString() : billing.current_period_end

  await upsertBillingAccount(billing.user_id, {
    status:paid ? 'active' : 'past_due',
    current_period_end:periodEnd,
    access_expires_at:paid ? periodEnd : new Date().toISOString(),
    last_event_at:new Date().toISOString(),
  })
}

function normalizeStatus(status = '') {
  if (status === 'trialing') return 'trialing'
  if (status === 'active') return 'active'
  if (status === 'past_due') return 'past_due'
  if (status === 'unpaid') return 'unpaid'
  if (status === 'canceled') return 'canceled'
  if (status === 'incomplete') return 'incomplete'
  if (status === 'incomplete_expired') return 'incomplete_expired'
  if (status === 'paused') return 'paused'
  return 'active'
}
