import { findBillingAccountByUser, getAppUrl, getAuthenticatedUser, getStripe } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error:'Method not allowed' })
  }

  try {
    const user = await getAuthenticatedUser(req)
    const billing = await findBillingAccountByUser(user.id)

    if (!billing?.stripe_customer_id) {
      return res.status(400).json({ error:'Conta ainda sem cliente Stripe vinculado.' })
    }

    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer:billing.stripe_customer_id,
      return_url:`${getAppUrl(req)}/app/billing`,
    })

    return res.status(200).json({ url:session.url })
  } catch (error) {
    return res.status(500).json({ error:error.message || 'Nao foi possivel abrir o portal de billing.' })
  }
}
