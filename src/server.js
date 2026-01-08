import express from 'express';
import NaverTitaniumScraper from './scraper-service.js';
import dotenv from 'dotenv';

dotenv.config();
const app = express();

app.get('/naver', async (req, res) => {
  const { productUrl } = req.query;

  if (!productUrl) return res.status(400).json({ error: "productUrl is required" });

  try {    
    const scraper = new NaverTitaniumScraper(productUrl);
    const result = await scraper.run();
    
    // Determine what was captured
    const hasProduct = result.data.product !== null;
    const hasBenefit = result.data.benefit !== null;
    
    let message = "All data captured";
    let statusCode = 200;
    
    if (!hasProduct && !hasBenefit) {
      message = "No data captured";
      statusCode = 206;
    } else if (!hasProduct || !hasBenefit) {
      message = "Partial content captured";
      statusCode = 206;
    }
    
    res.status(statusCode).json({ 
      message,
      data: result.data,
      ...(result.error && { error: result.error })
    });
  } catch (error) {
    console.error('🔴 Request failed:', error.message);
    
    // Check for connection errors
    if (error.message.includes('ECONNRESET') || 
        error.message.includes('socket hang up') ||
        error.message.includes('ETIMEDOUT')) {
      res.status(503).json({ 
        error: error.message,
        hint: "Connection issue - proxy may be rate limiting. Try again in a few seconds."
      });
    } else if (error.message.includes('429') || error.message.includes('BLOCKED')) {
      res.status(429).json({ 
        error: error.message,
        hint: "IP has been blocked. Consider using a different proxy."
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.listen(3000, () => console.log('🚀 API Ready on port 3000'));