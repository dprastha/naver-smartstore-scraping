import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUA from 'puppeteer-extra-plugin-anonymize-ua';

import dotenv from 'dotenv';

// Config
dotenv.config();

// 1. Activate Evasion
puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUA());

class NaverTitaniumScraper {
  constructor(targetProductUrl) {
    this.browser = null;
    this.capturedData = {
      product: null,
      benefits: null
    };
    this.targetProductUrl = targetProductUrl;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async run() {
    console.log(`🛡️  Initializing Titanium Scraper...`);
    console.log(`📍 Target: ${this.targetProductUrl}`);

    // Parse Store URL from Product URL
    const storeMatch = this.targetProductUrl.match(/(https:\/\/(?:smartstore|brand)\.naver\.com\/[^/]+)/);
    if (!storeMatch) throw new Error("Invalid URL format");
    const storeUrl = storeMatch[1];

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      `--lang=ko-KR,ko;q=0.9` // Force browser language at launch
    ];

    // ✅ PROXY SETUP
    if (process.env.PROXY_HOST) {
      launchArgs.push(`--proxy-server=${process.env.PROXY_HOST}`);
      console.log(`🌐 Proxy attached: ${process.env.PROXY_HOST}`);
    }

    console.log

    try {
      this.browser = await puppeteer.launch({
        headless: false, // Must be false
        args: launchArgs,
        ignoreHTTPSErrors: true
      });

      const page = await this.browser.newPage();

      // ✅ 1. PROXY AUTHENTICATION (Crucial for Residential Proxies)
      if (process.env.PROXY_USER && process.env.PROXY_PASS) {
        await page.authenticate({ 
          username: process.env.PROXY_USER, 
          password: process.env.PROXY_PASS 
        });
        console.log(`🔑 Proxy Authenticated`);
      }

      // ✅ 2. FINGERPRINT MASKING (Sync Timezone with Proxy)
      // If IP is KR but Timezone is Jakarta/NY, you get 429.
      await page.emulateTimezone('Asia/Seoul');
      
      // Explicitly set Korean Headers
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      // ✅ 3. VISIT STORE HOMEPAGE (The Trust Anchor)
      console.log(`🏠 Loading Store Homepage...`);
      try {
        await page.goto(storeUrl, { waitUntil: 'domcontentloaded', timeout: process.env.TIMEOUT });
      } catch (e) {
        console.log(`⚠️  Store load timeout, but checking if content exists...`);
      }

      // Check if we actually got blocked
      const title = await page.title();
      console.log(`📄 Page Title: ${title}`);
      if (title.includes('429') || title.includes('Suspicious') || title.length < 2) {
        throw new Error("⛔ 429 BLOCKED. Your Proxy IP is likely blacklisted by Naver.");
      }

      // Allow security scripts (anti-bot) to settle
      await this.sleep(2_000); 
      await this.simulateHumanWiggle(page);

      // ✅ 4. THE MAGIC LINK INJECTION (Organic Tab Forking)
      // We inject a link to the product and click it. This inherits all cookies/session tokens.
      console.log(`🔗 Injecting Organic Link for Product...`);
      
      const newPagePromise = new Promise(resolve => {
        this.browser.once('targetcreated', async (target) => {
          const newPage = await target.page();
          
          newPage.on('response', async (response) => {
            const url = response.url();
            if (url.includes('/i/v2/channels/') && url.includes('/products/') && url.includes('withWindow')) {
                if (response.status() == 200) {
                    console.log('Captured product API', url)
                    try {
                        const productData = await response.json()
                        this.capturedData.product = productData
                    } catch(e) {
                        console.log('error capture product data', e)
                    }
                } else {
                    console.log('Can not capture product detail due to', response.status())
                }
            }

            if (url.includes('/benefits/by-products')) {
                if (response.status() == 200) {
                    console.log('Captured benefit product API', url)
                    try {
                        const benefitData = await response.json()
                        this.capturedData.benefits = benefitData
                    } catch(e) {
                        console.log('error capture benefit product data', e)
                    }
                } else {
                    console.log('Can not capture benefit product due to', response.status())
                }
            }
          });

          resolve(newPage);
        });
      });
      
      await page.evaluate((productUrl) => {
        const a = document.createElement('a');
        a.href = productUrl;
        a.target = '_blank';
        a.innerText = 'GoToProduct';
        a.style.display = 'block';
        a.style.position = 'absolute';
        a.style.top = '10px';
        a.style.left = '10px';
        a.style.zIndex = '99999';
        document.body.appendChild(a);
        
        // Dispatch a trusted event
        const mouseEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        a.dispatchEvent(mouseEvent);
      }, this.targetProductUrl);

      console.log(`🖱️  Click dispatched. Waiting for tab...`);
      
      const productPage = await newPagePromise;
      if (!productPage) throw new Error("Tab opened but handle lost.");
      
      // Wait for product page load
      await productPage.setViewport({ width: 1920, height: 1080 });
      await productPage.waitForSelector('body', { timeout: process.env.TIMEOUT });
      
      // Wait for hydration (Naver is React/SSR heavy)
      console.log(`✅ Product Page Loaded. Waiting for hydration...`);
      await this.sleep(6_000);

      return {data: {
        product: this.capturedData.product,
        benefit: this.capturedData.benefits
      }}
    } catch (error) {
      console.error(`\n❌ ERROR: ${error.message}`);
    } finally {
      if (this.browser) await this.browser.close();
    }
  }

  // Helper: Wiggle mouse to prove humanity
  async simulateHumanWiggle(page) {
    await page.mouse.move(100, 100);
    await page.mouse.move(200, 200, { steps: 10 });
    await page.evaluate(() => window.scrollTo(0, 500));
    await this.sleep(1000);
  }
}

export default NaverTitaniumScraper;