const fetch = require('node-fetch');

class AIAnalysisService {
  constructor() {
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.geminiKey = process.env.GEMINI_API_KEY;
    this.grokKey = process.env.GROK_API_KEY;
  }

  // Get filing priority information
  getFilingPriority(formType) {
    const priorities = {
      '10-K': { level: 'high', emoji: '🔴', description: 'Annual Report - Comprehensive financial update' },
      '10-Q': { level: 'high', emoji: '🔴', description: 'Quarterly Report - Financial update' },
      '8-K': { level: 'high', emoji: '🔴', description: 'Current Report - Major company events' },
      'S-1': { level: 'high', emoji: '🔴', description: 'IPO Registration - Company going public' },
      'S-4': { level: 'medium', emoji: '🟡', description: 'Merger/Acquisition Registration' },
      'DEF 14A': { level: 'medium', emoji: '🟡', description: 'Proxy Statement - Shareholder voting' },
      '4': { level: 'low', emoji: '🟢', description: 'Insider Trade - Executives buying/selling' },
      '3': { level: 'low', emoji: '🟢', description: 'Initial Insider Ownership' },
      'SC 13G': { level: 'low', emoji: '🟢', description: 'Large Shareholder Disclosure' },
      'SC 13D': { level: 'medium', emoji: '🟡', description: 'Activist Investor Disclosure' }
    };

    return priorities[formType] || { level: 'low', emoji: '⚪', description: formType };
  }

  // Determine if filing is important enough to analyze
  isHighPriorityFiling(formType) {
    const priority = this.getFilingPriority(formType);
    return priority.level === 'high';
  }

  // Analyze filing with Claude (Anthropic)
  async analyzeWithClaude(filingText, company, formType) {
    if (!this.anthropicKey) {
      console.log('⚠️ No Anthropic API key configured');
      return null;
    }

    try {
      const prompt = `You are a financial analyst. Analyze this ${formType} filing for ${company}.

Filing content (truncated to 50k chars):
${filingText.substring(0, 50000)}

Provide:
1. Overall sentiment (bullish/bearish/neutral)
2. Key highlights (3-5 points)
3. Risk factors (2-3 points)
4. Stock price prediction (confidence level 0-100, predicted change -100 to +100)

Respond in JSON format:
{
  "sentiment": "bullish/bearish/neutral",
  "confidence": 85,
  "predicted_change": 5.2,
  "key_highlights": ["point1", "point2"],
  "bullish_factors": ["factor1", "factor2"],
  "bearish_factors": ["risk1", "risk2"],
  "reasoning": "explanation"
}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.content[0].text;
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }
      
      const analysis = JSON.parse(jsonMatch[0]);
      
      return {
        provider: 'claude',
        ...analysis
      };
    } catch (error) {
      console.error('Claude analysis error:', error);
      return null;
    }
  }

  // Analyze filing with Gemini (Google)
  async analyzeWithGemini(filingText, company, formType) {
    if (!this.geminiKey) {
      console.log('⚠️ No Gemini API key configured');
      return null;
    }

    try {
      const prompt = `You are a financial analyst. Analyze this ${formType} filing for ${company}.

Filing content (truncated to 50k chars):
${filingText.substring(0, 50000)}

Provide:
1. Overall sentiment (bullish/bearish/neutral)
2. Key highlights (3-5 points)
3. Risk factors (2-3 points)
4. Stock price prediction (confidence level 0-100, predicted change -100 to +100)

Respond in JSON format:
{
  "sentiment": "bullish/bearish/neutral",
  "confidence": 85,
  "predicted_change": 5.2,
  "key_highlights": ["point1", "point2"],
  "bullish_factors": ["factor1", "factor2"],
  "bearish_factors": ["risk1", "risk2"],
  "reasoning": "explanation"
}`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Gemini response');
      }
      
      const analysis = JSON.parse(jsonMatch[0]);
      
      return {
        provider: 'gemini',
        ...analysis
      };
    } catch (error) {
      console.error('Gemini analysis error:', error);
      return null;
    }
  }

  // Analyze filing with Grok (xAI)
  async analyzeWithGrok(filingText, company, formType) {
    if (!this.grokKey) {
      console.log('⚠️ No Grok API key configured');
      return null;
    }

    try {
      const prompt = `You are a financial analyst. Analyze this ${formType} filing for ${company}.

Filing content (truncated to 50k chars):
${filingText.substring(0, 50000)}

Provide:
1. Overall sentiment (bullish/bearish/neutral)
2. Key highlights (3-5 points)
3. Risk factors (2-3 points)
4. Stock price prediction (confidence level 0-100, predicted change -100 to +100)

Respond in JSON format:
{
  "sentiment": "bullish/bearish/neutral",
  "confidence": 85,
  "predicted_change": 5.2,
  "key_highlights": ["point1", "point2"],
  "bullish_factors": ["factor1", "factor2"],
  "bearish_factors": ["risk1", "risk2"],
  "reasoning": "explanation"
}`;

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.grokKey}`
        },
        body: JSON.stringify({
          model: 'grok-beta',
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        throw new Error(`Grok API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.choices[0].message.content;
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Grok response');
      }
      
      const analysis = JSON.parse(jsonMatch[0]);
      
      return {
        provider: 'grok',
        ...analysis
      };
    } catch (error) {
      console.error('Grok analysis error:', error);
      return null;
    }
  }

  // Main method to analyze a filing with multiple AIs
  async analyzeFiling(filingText, company, formType, ticker, aiPreferences = null) {
    console.log(`🤖 Analyzing ${formType} filing for ${company}...`);
    
    // Skip low-priority filings to save API costs
    if (!this.isHighPriorityFiling(formType)) {
      console.log(`⏭️  Skipping low-priority filing type: ${formType}`);
      return null;
    }

    // Default to all AIs if no preferences provided
    const prefs = aiPreferences || { claude: true, gemini: true, grok: true };
    console.log('🎯 Using AIs:', Object.keys(prefs).filter(k => prefs[k]).join(', '));

    // Run selected AI analyses in parallel
    const analyses = await Promise.all([
      prefs.claude ? this.analyzeWithClaude(filingText, company, formType) : null,
      prefs.gemini ? this.analyzeWithGemini(filingText, company, formType) : null,
      prefs.grok ? this.analyzeWithGrok(filingText, company, formType) : null
    ]);

    const validAnalyses = analyses.filter(a => a !== null);

    if (validAnalyses.length === 0) {
      console.log('❌ No AI analyses completed successfully');
      return null;
    }

    console.log(`✅ Completed ${validAnalyses.length} AI analysis(es)`);

    // Aggregate results from multiple AIs
    return this.aggregateAnalyses(validAnalyses);
  }

  // Aggregate multiple AI analyses into consensus
  aggregateAnalyses(analyses) {
    if (analyses.length === 0) return null;
    if (analyses.length === 1) return analyses[0];

    // Calculate consensus sentiment
    const sentiments = analyses.map(a => a.sentiment);
    const sentimentCounts = sentiments.reduce((acc, s) => {
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const consensusSentiment = Object.keys(sentimentCounts)
      .sort((a, b) => sentimentCounts[b] - sentimentCounts[a])[0];

    // Average confidence and predicted change
    const avgConfidence = Math.round(
      analyses.reduce((sum, a) => sum + a.confidence, 0) / analyses.length
    );
    const avgPredictedChange = 
      analyses.reduce((sum, a) => sum + a.predicted_change, 0) / analyses.length;

    // Combine all highlights and factors (deduplicate similar ones)
    const allHighlights = [...new Set(analyses.flatMap(a => a.key_highlights || []))];
    const allBullish = [...new Set(analyses.flatMap(a => a.bullish_factors || []))];
    const allBearish = [...new Set(analyses.flatMap(a => a.bearish_factors || []))];

    return {
      providers: analyses.map(a => a.provider),
      sentiment: consensusSentiment,
      confidence: avgConfidence,
      predicted_change: parseFloat(avgPredictedChange.toFixed(2)),
      key_highlights: allHighlights.slice(0, 5),
      bullish_factors: allBullish.slice(0, 3),
      bearish_factors: allBearish.slice(0, 3),
      reasoning: `Consensus from ${analyses.length} AI models: ${analyses.map(a => a.provider).join(', ')}`
    };
  }
}

module.exports = new AIAnalysisService();
