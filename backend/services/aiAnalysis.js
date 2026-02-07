// services/aiAnalysis.js - Multi-AI Sentiment Analysis for SEC Filings
const fetch = require('node-fetch');

class AIAnalysisService {
  constructor() {
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.geminiKey = process.env.GEMINI_API_KEY;
    this.grokKey = process.env.GROK_API_KEY;
  }

  // Determine if filing is important enough to analyze
  isHighPriorityFiling(formType) {
    const highPriority = ['10-K', '10-Q', '8-K', 'DEF 14A', '13F-HR', 'SC 13D', 'SC 13G'];
    return highPriority.includes(formType);
  }

  // Get filing priority level and description
  getFilingPriority(formType) {
    const priorities = {
      '10-K': { level: 'high', emoji: '🔴', description: 'Annual Report - Complete financials' },
      '10-Q': { level: 'high', emoji: '🔴', description: 'Quarterly Report - Financial update' },
      '8-K': { level: 'high', emoji: '🔴', description: 'Current Report - Major company events' },
      'DEF 14A': { level: 'medium', emoji: '🟡', description: 'Proxy Statement - Shareholder voting' },
      '13F-HR': { level: 'medium', emoji: '🟡', description: 'Institutional Holdings - Big money moves' },
      'SC 13D': { level: 'medium', emoji: '🟡', description: 'Major Shareholder - Someone bought >5%' },
      'SC 13G': { level: 'medium', emoji: '🟡', description: 'Passive Ownership - >5% stake disclosed' },
      '4': { level: 'low', emoji: '🟢', description: 'Insider Trade - Executives buying/selling' },
      '3': { level: 'low', emoji: '🟢', description: 'Initial Insider Ownership' },
      '5': { level: 'low', emoji: '🟢', description: 'Annual Insider Update' },
    };
    
    return priorities[formType] || { level: 'low', emoji: '⚪', description: formType };
  }

  // Analyze filing with Claude (Anthropic)
  async analyzeWithClaude(filingText, company, formType) {
    if (!this.anthropicKey) {
      console.log('⚠️ No Anthropic API key configured');
      return null;
    }

    try {
      const prompt = `You are a financial analyst expert. Analyze this SEC ${formType} filing for ${company} and provide:

1. A brief 2-3 sentence summary of what happened
2. A detailed "what happened" explanation (4-5 sentences)
3. Expected stock price impact (bullish/bearish/neutral)
4. Expected price move percentage (e.g., +2.5%, -1.2%)
5. Confidence level (0-100)
6. Key bullish factors (list)
7. Key bearish/risk factors (list)

Filing excerpt (first 8000 chars):
${filingText.substring(0, 8000)}

Respond ONLY with valid JSON in this exact format:
{
  "brief_summary": "2-3 sentence summary",
  "detailed_summary": "4-5 sentence detailed explanation",
  "sentiment": "bullish" | "bearish" | "neutral",
  "expected_move": 2.5,
  "confidence": 85,
  "bullish_factors": ["factor 1", "factor 2"],
  "bearish_factors": ["risk 1", "risk 2"],
  "reasoning": "Why this direction and magnitude"
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
          max_tokens: 2000,
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
      
      // Extract JSON from response (remove markdown code blocks if present)
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
      const prompt = `You are a financial analyst. Analyze this SEC ${formType} filing for ${company}.

Filing excerpt: ${filingText.substring(0, 8000)}

Respond ONLY with valid JSON:
{
  "brief_summary": "2-3 sentence summary",
  "detailed_summary": "4-5 sentence explanation",
  "sentiment": "bullish" | "bearish" | "neutral",
  "expected_move": 2.5,
  "confidence": 85,
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
      const prompt = `You are a financial analyst. Analyze this SEC ${formType} filing for ${company}.

Filing excerpt: ${filingText.substring(0, 8000)}

Respond ONLY with valid JSON:
{
  "brief_summary": "2-3 sentence summary",
  "detailed_summary": "4-5 sentence explanation",
  "sentiment": "bullish" | "bearish" | "neutral",
  "expected_move": 2.5,
  "confidence": 85,
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
          }],
          temperature: 0.7
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

  // Get consensus from multiple AI analyses
  calculateConsensus(analyses) {
    if (!analyses || analyses.length === 0) {
      return null;
    }

    // Filter out null analyses
    const validAnalyses = analyses.filter(a => a !== null);
    if (validAnalyses.length === 0) {
      return null;
    }

    // Calculate average expected move
    const moves = validAnalyses.map(a => a.expected_move);
    const avgMove = moves.reduce((sum, m) => sum + m, 0) / moves.length;
    const minMove = Math.min(...moves);
    const maxMove = Math.max(...moves);

    // Calculate average confidence
    const confidences = validAnalyses.map(a => a.confidence);
    const avgConfidence = Math.round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length);

    // Determine consensus sentiment
    const sentiments = validAnalyses.map(a => a.sentiment);
    const bullishCount = sentiments.filter(s => s === 'bullish').length;
    const bearishCount = sentiments.filter(s => s === 'bearish').length;
    
    let consensusSentiment;
    if (bullishCount > bearishCount) {
      consensusSentiment = 'bullish';
    } else if (bearishCount > bullishCount) {
      consensusSentiment = 'bearish';
    } else {
      consensusSentiment = 'neutral';
    }

    // Combine all factors
    const allBullishFactors = validAnalyses.flatMap(a => a.bullish_factors || []);
    const allBearishFactors = validAnalyses.flatMap(a => a.bearish_factors || []);

    return {
      sentiment: consensusSentiment,
      expected_move_avg: Math.round(avgMove * 100) / 100,
      expected_move_min: Math.round(minMove * 100) / 100,
      expected_move_max: Math.round(maxMove * 100) / 100,
      confidence: avgConfidence,
      agreement_level: bullishCount === validAnalyses.length || bearishCount === validAnalyses.length ? 'unanimous' : 
                      Math.abs(bullishCount - bearishCount) <= 1 ? 'split' : 'majority',
      ai_count: validAnalyses.length,
      bullish_factors: [...new Set(allBullishFactors)].slice(0, 5),
      bearish_factors: [...new Set(allBearishFactors)].slice(0, 5)
    };
  }

  // Main analysis function - gets consensus from selected AIs
  async analyzeFiling(filingText, company, formType, ticker, aiPreferences = null) {
    console.log(`🤖 Analyzing ${formType} filing for ${company}...`);

    // Only analyze high-priority filings
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

    console.log(`✅ Got ${validAnalyses.length} AI analyses from: ${validAnalyses.map(a => a.provider).join(', ')}`);

    // Calculate consensus
    const consensus = this.calculateConsensus(validAnalyses);

    // Use the first valid analysis for summaries (they should be similar)
    const primaryAnalysis = validAnalyses[0];

    return {
      brief_summary: primaryAnalysis.brief_summary,
      detailed_summary: primaryAnalysis.detailed_summary,
      sentiment_direction: consensus.sentiment,
      expected_move_min: consensus.expected_move_min,
      expected_move_max: consensus.expected_move_max,
      expected_move_avg: consensus.expected_move_avg,
      confidence_score: consensus.confidence,
      bullish_factors: consensus.bullish_factors,
      bearish_factors: consensus.bearish_factors,
      ai_consensus: {
        analyses: validAnalyses,
        agreement: consensus.agreement_level,
        provider_count: validAnalyses.length
      }
    };
  }
}

module.exports = new AIAnalysisService();
