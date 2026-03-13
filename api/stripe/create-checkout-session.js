import { buildStripePriceMap } from '../../src/billing/plans.js'
import { findBillingAccountByUser, getAppUrl, getAuthenticatedUser, getStripe, upsertBillingAccount } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  try {
    const user = await getAuthenticatedUser(req)
    const { planId = 'mensal' } = req.body || {}
    const priceMap = buildStripePriceMap()
    const priceId = priceMap[planId]

    if (!priceId) {
      return res.status(503).json({ error:`Stripe price ID ausente para o plano ${planId}` })
    }

    const stripe = getStripe()
    const appUrl = getAppUrl(req)
    const current = await findBillingAccountByUser(user.id)

    let customerId = current?.stripe_customer_id || ''
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:user.email,
        name:user.user_metadata?.name || undefined,
        metadata:{ user_id:user.id },
      })
      customerId = customer.id
    }

    const session = await stripe.checkout.sessions.create({
      mode:'subscription',
      customer:customerId,
      line_items:[{ price:priceId, quantity:1 }],
      success_url:`${appUrl}/app/billing?checkout=success`,
      cancel_url:`${appUrl}/app/billing?checkout=cancel`,
      allow_promotion_codes:true,
      billing_address_collection:'auto',
      locale:'pt-BR',
      client_reference_id:user.id,
      metadata:{
        user_id:user.id,
        plan_id:planId,
      },
      subscription_data:{
        metadata:{
          user_id:user.id,
          plan_id:planId,
        },
      },
    })

    await upsertBillingAccount(user.id, {
      email:user.email,
      selected_plan:planId,
      stripe_customer_id:customerId,
      stripe_checkout_session_id:session.id,
      stripe_price_id:priceId,
    })

    return res.status(200).json({ url:session.url })
  } catch (error) {
    return res.status(500).json({ error:error.message || 'Nao foi possivel criar a sessao de checkout.' })
  }
}
