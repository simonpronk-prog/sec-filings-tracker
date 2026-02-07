// services/shortInterest.js - Fetch short interest data from FINRA
const fetch = require('node-fetch');

class ShortInterestService {
  constructor() {
    this.finraUrl = 'https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/api/v1/data';
    this.cache = new Map();
    this.cacheExpiry = 12 * 60 * 60 * 1000; // 12 hours
  }

  // Get short interest for a ticker
  async getShortInterest(ticker) {
    if (!ticker) {
      return null;
    }

    // Check cache first
    const cached = this.cache.get(ticker);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      console.log(`📊 Using cached short interest for ${ticker}`);
      return cached.data;
    }

    try {
      console.log(`📊 Fetching short interest data for ${ticker}...`);

      // FINRA short interest is updated twice monthly
      // We'll try to fetch the most recent data
      const response = await fetch(`${this.finraUrl}?symbol=${ticker}&limit=1`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SEC Filings Tracker'
        }
      });

      if (!response.ok) {
        console.log(`⚠️ FINRA API returned ${response.status} for ${ticker}`);
        return null;
      }

      const data = await response.json();

      if (!data || data.length === 0) {
        console.log(`⚠️ No short interest data found for ${ticker}`);
        return null;
      }

      const latestData = data[0];
      
      // Calculate short interest percentage
      // Note: FINRA provides short volume, not total short interest
      // For actual short interest %, we'd need shares outstanding data
      const shortInterestData = {
        ticker: ticker,
        short_volume: latestData.shortVolume,
        total_volume: latestData.totalVolume,
        short_volume_percent: latestData.shortVolume && latestData.totalVolume 
          ? Math.round((latestData.shortVolume / latestData.totalVolume) * 10000) / 100
          : null,
        date: latestData.date,
        updated_at: new Date()
      };

      // Cache the result
      this.cache.set(ticker, {
        data: shortInterestData,
        timestamp: Date.now()
      });

      console.log(`✅ Got short interest for ${ticker}: ${shortInterestData.short_volume_percent}%`);
      return shortInterestData;

    } catch (error) {
      console.error(`Error fetching short interest for ${ticker}:`, error.message);
      return null;
    }
  }

  // Alternative: Parse short interest from Yahoo Finance or other free sources
  // This is a backup method if FINRA API doesn't work
  async getShortInterestFromYahoo(ticker) {
    try {
      // Yahoo Finance often has short interest data in their statistics page
      // This would require HTML scraping, which we can implement if needed
      console.log(`📊 Attempting to fetch short data from alternative source for ${ticker}...`);
      
      // For now, return mock data structure
      // In production, you'd implement actual scraping here
      return null;
    } catch (error) {
      console.error('Error fetching from Yahoo:', error);
      return null;
    }
  }

  // Interpret short interest level
  interpretShortInterest(shortPercent) {
    if (!shortPercent) {
      return { level: 'unknown', message: 'Data unavailable' };
    }

    if (shortPercent < 5) {
      return { 
        level: 'low', 
        emoji: '🟢',
        message: 'Low short interest - limited squeeze potential'
      };
    } else if (shortPercent < 10) {
      return { 
        level: 'moderate', 
        emoji: '🟡',
        message: 'Moderate short interest - watch for catalysts'
      };
    } else if (shortPercent < 20) {
      return { 
        level: 'high', 
        emoji: '🟠',
        message: 'High short interest - squeeze potential on good news'
      };
    } else {
      return { 
        level: 'very_high', 
        emoji: '🔴',
        message: 'Very high short interest - major squeeze risk for shorts'
      };
    }
  }

  // Clear cache (useful for manual refresh)
  clearCache() {
    this.cache.clear();
    console.log('🗑️  Short interest cache cleared');
  }
}

module.exports = new ShortInterestService();
