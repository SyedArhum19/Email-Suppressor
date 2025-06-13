import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// 🧠 Capture raw body for HMAC verification
app.use(bodyParser.raw({
  type: 'application/json',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// 🔐 Shopify HMAC Verification
function verifyHmac(req) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader || !req.rawBody) return false;

  const generatedHmac = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(req.rawBody, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(hmacHeader, 'utf8'),
    Buffer.from(generatedHmac, 'utf8')
  );
}

console.log("Shopify store:", process.env.SHOPIFY_SHOP);
console.log("Admin token present?", !!process.env.SHOPIFY_API_TOKEN);


app.post('/webhook', async (req, res) => {
  console.log("📥 Incoming webhook request");
  

  // 🛡️ Verify HMAC or skip in development
  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️ HMAC verification skipped in development');
  } else if (!verifyHmac(req)) {
    console.warn('❌ HMAC verification failed');
    return res.status(401).send('Unauthorized');
  }

  let order;
  try {
    order = JSON.parse(req.rawBody.toString());
    console.log("🛍️ Incoming Order Payload Summary:");
console.log("Order ID:", order.id);
console.log("Tags:", order.tags);
console.log("Email:", order.email);
console.log("Customer ID:", order.customer?.id);
console.log("Customer Email:", order.customer?.email);
console.log("Line Items:", order.line_items?.length);
console.log("Line Items Detail:");
console.dir(order.line_items, { depth: null });

console.log("Shipping Address:");
console.dir(order.shipping_address, { depth: null });

console.log("Billing Address:");
console.dir(order.billing_address, { depth: null });

console.log("Discount Codes:");
console.dir(order.discount_codes, { depth: null });

console.log("Total Price:", order.total_price);
console.log("Order Created At:", order.created_at);

  } catch (err) {
    console.error('❌ Failed to parse order payload:', err.message);
    return res.sendStatus(400);
  }

  console.log("📦 Order received:", order.id);

  const { id: orderId, tags = '', customer } = order;

  // ✅ Shopify sends tags as comma-separated string
  const tagList = tags.split(',').map(t => t.trim().toLowerCase());

  if (!tagList.includes('appstle_subscription_recurring_order') || !customer?.id) {
    console.log(`⚠️ Skipping order ${orderId} (tag not found or customer missing)`);
    return res.sendStatus(200);
  }

  const customerId = customer.id;
  const originalEmail = customer.email;

  console.log(`🔒 Detected subscription order ${orderId}, suppressing email for customer ${customerId}`);

  const customerUrl = `https://${process.env.SHOPIFY_SHOP}/admin/api/${process.env.SHOPIFY_API_VERSION}/customers/${customerId}.json`;

  const headers = {
    'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN,
    'Content-Type': 'application/json',
  };

  try {
  const customerResp = await axios.get(customerUrl, { headers });
  const fullCustomer = customerResp.data.customer;

  console.log("🧾 Customer Tags:", fullCustomer.tags);
} catch (err) {
  console.error("❌ Failed to fetch full customer info:", err.message);
}
  
  // ✅ Respond quickly to Shopify
  res.sendStatus(200);

  try {
    // 🛑 Suppress email
    await axios.put(customerUrl, {
      customer: { id: customerId, email: `suppressed-${Date.now()}@noemail.fake` },
    }, { headers });

    console.log(`✅ Email removed for customer ${customerId}`);

    // 🔄 Restore after 8 seconds
    setTimeout(async () => {
      try {
        await axios.put(customerUrl, {
          customer: { id: customerId, email: originalEmail },
        }, { headers });
        console.log(`✅ Email restored for customer ${customerId}`);
      } catch (err) {
        console.error('❌ Failed to restore email:', err.message);
      }
    }, 8000);

  } catch (err) {
    console.error('❌ Failed to suppress email:', err.message);
  }
});

app.listen(port, () => {
  console.log(`🚀 Middleware app live and listening on port ${port}`);
});
