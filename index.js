import express from 'express';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;


// 🧠 Use raw body parser with verify to store raw buffer per request
app.use(bodyParser.raw({
  type: 'application/json',
  verify: (req, res, buf) => {
    req.rawBody = buf;  // attach to request
  }
}));

// 🔐 HMAC Verification
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

// ✅ Logs
console.log("Shopify store:", process.env.SHOPIFY_SHOP);
console.log("Admin token present?", !!process.env.SHOPIFY_API_TOKEN);

app.post('/webhook', async (req, res) => {
  try {
    // ✅ HMAC Check
    if (process.env.NODE_ENV !== 'production') {
  console.warn('⚠️ HMAC verification skipped in development');
} else if (!verifyHmac(req)) {
  console.warn('⚠️ HMAC verification failed');
  return res.status(401).send('Unauthorized');
}

   


    const order = JSON.parse(req.rawBody.toString());
    console.log("Incoming order payload:", order);

    const { id: orderId, tags, customer } = order;

    if (!tags?.includes('Subscription') || !customer?.id) {
      console.log(`Skipping order ${orderId} (not a subscription or missing customer)`);
      return res.sendStatus(200);
    }

    const customerId = customer.id;
    const originalEmail = customer.email;

    console.log(`Detected subscription order ${orderId} - suppressing email`);

    const customerUrl = `https://${process.env.SHOPIFY_SHOP}/admin/api/${process.env.SHOPIFY_API_VERSION}/customers/${customerId}.json`;

    const headers = {
      'X-Shopify-Access-Token': process.env.SHOPIFY_API_TOKEN,
      'Content-Type': 'application/json',
    };

    // ✅ Remove email
    await axios.put(customerUrl, {
      customer: { id: customerId, email: `suppressed-${Date.now()}@noemail.fake` },
    }, { headers });

    console.log(`Removed email for customer ${customerId}`);

    // ✅ Restore after 8 seconds
    setTimeout(async () => {
      try {
        await axios.put(customerUrl, {
          customer: { id: customerId, email: originalEmail },
        }, { headers });
        console.log(`Restored email for customer ${customerId}`);
      } catch (err) {
        console.error('❌ Failed to restore email:', err.message);
      }
    }, 8000);

    res.sendStatus(200);

  } catch (err) {
    console.error('❌ Error in webhook handler:', err.message);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`✅ Middleware app live and listening on port ${port}`);
});
