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

  // Build the standard prompt for all AI providers
  buildPrompt(filingText, company, formType) {
    return `You are a financial analyst. Analyze this ${formType} filing for ${company}.

Filing content (truncated to 50k chars):
${filingText.substring(0, 50000)}

Provide your analysis in the following JSON format ONLY (no other text):
{
  "sentiment": "bullish or bearish or neutral",
  "confidence": 85,
  "predicted_change": 5.2,
  "key_highlights": ["point1", "point2", "point3"],
  "bullish_factors": ["factor1", "factor2"],
  "bearish_factors": ["risk1", "risk2"],
  "reasoning": "2-3 sentence explanation of your analysis"
}`;
  }

  // Normalize raw AI response into the format server.js expects for database storage
  normalizeAnalysis(raw, provider) {
    const predictedChange = parseFloat(raw.predicted_change) || 0;
    const confidence = parseInt(raw.confidence) || 50;

    // Map the AI response fields to what server.js saves to the database
    return {
      provider: provider,
      // Fields that server.js reads for database columns:
      brief_summary: `${raw.sentiment ? raw.sentiment.charAt(0).toUpperCase() + raw.sentiment.slice(1) : 'Neutral'} outlook (${confidence}% confidence). ${(raw.key_highlights || []).slice(0, 2).join('. ')}`,
      detailed_summary: raw.reasoning || 'No detailed reasoning provided.',
      sentiment_direction: raw.sentiment || 'neutral',
      expected_move_min: Math.min(predictedChange, predictedChange * 0.7).toFixed(2),
      expected_move_max: Math.max(predictedChange, predictedChange * 1.3).toFixed(2),
      expected_move_avg: predictedChange.toFixed(2),
      confidence_score: confidence,
      bullish_factors: raw.bullish_factors || [],
      bearish_factors: raw.bearish_factors || [],
      ai_consensus: {
        providers: [provider],
        sentiment: raw.sentiment || 'neutral',
        confidence: confidence,
        predicted_change: predictedChange,
        key_highlights: raw.key_highlights || []
      },
      // Also keep original fields for direct use
      sentiment: raw.sentiment || 'neutral',
      confidence: confidence,
      predicted_change: predictedChange,
      key_highlights: raw.key_highlights || [],
      reasoning: raw.reasoning || ''
    };
  }

  // Extract JSON from AI response text (handles markdown code blocks etc.)
  extractJSON(text) {
    // Try direct parse first
    try {
      return JSON.parse(text.trim());
    } catch (e) {
      // Fall through
    }

    // Try to find JSON in markdown code blocks or raw text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in AI response');
    }
    return JSON.parse(jsonMatch[0]);
  }

  // Helper: sleep for ms
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Helper: retry a function with exponential backoff on 429 errors
  async retryWithBackoff(fn, maxRetries = 3, baseDelay = 5000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        const is429 = error.message && error.message.includes('429');
        if (is429 && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt); // 5s, 10s, 20s
          console.log(`⏳ Rate limited (429), retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})...`);
          await this.sleep(delay);
        } else {
          throw error;
        }
      }
    }
  }

  // Analyze filing with Claude (Anthropic)
  async analyzeWithClaude(filingText, company, formType) {
    if (!this.anthropicKey) {
      console.log('⚠️ No Anthropic API key configured');
      return null;
    }

    try {
      const prompt = this.buildPrompt(filingText, company, formType);

      const result = await this.retryWithBackoff(async () => {
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

        return response;
      });

      const data = await result.json();
      const text = data.content[0].text;
      const analysis = this.extractJSON(text);

      return this.normalizeAnalysis(analysis, 'claude');
    } catch (error) {
      console.error('Claude analysis error:', error);
      return null;
    }
  }

  // Analyze filing with Gemini (Google)
  // NOTE: gemini-1.5-pro was RETIRED by Google and returns 404 as of Feb 2026
  // Using gemini-2.0-flash which is current and available
  async analyzeWithGemini(filingText, company, formType) {
    if (!this.geminiKey) {
      console.log('⚠️ No Gemini API key configured');
      return null;
    }

    try {
      const prompt = this.buildPrompt(filingText, company, formType);

      const result = await this.retryWithBackoff(async () => {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiKey}`, {
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

        return response;
      });

      const data = await result.json();
      const text = data.candidates[0].content.parts[0].text;
      const analysis = this.extractJSON(text);

      return this.normalizeAnalysis(analysis, 'gemini');
    } catch (error) {
      console.error('Gemini analysis error:', error);
      return null;
    }
  }

  // Analyze filing with Grok (xAI)
  // NOTE: grok-beta was RETIRED and returns 404 as of Feb 2026
  // Using grok-4-1-fast-non-reasoning: $0.20/$0.50 per M tokens, 2M context, fast
  async analyzeWithGrok(filingText, company, formType) {
    if (!this.grokKey) {
      console.log('⚠️ No Grok API key configured');
      return null;
    }

    try {
      const prompt = this.buildPrompt(filingText, company, formType);

      const result = await this.retryWithBackoff(async () => {
        const response = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.grokKey}`
          },
          body: JSON.stringify({
            model: 'grok-4-1-fast-non-reasoning',
            messages: [{
              role: 'user',
              content: prompt
            }]
          })
        });

        if (!response.ok) {
          throw new Error(`Grok API error: ${response.status}`);
        }

        return response;
      });

      const data = await result.json();
      const text = data.choices[0].message.content;
      const analysis = this.extractJSON(text);

      return this.normalizeAnalysis(analysis, 'grok');
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

    // Default to Claude + Grok (Gemini 1.5 is retired, user can re-enable Gemini in settings)
    const prefs = aiPreferences || { claude: true, gemini: false, grok: true };
    
    const enabledAIs = Object.keys(prefs).filter(k => prefs[k]);
    if (enabledAIs.length === 0) {
      console.log('⚠️ No AI providers enabled in preferences');
      return null;
    }
    
    console.log('🎯 Using AIs:', enabledAIs.join(', '));

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

    // Combine all highlights and factors (deduplicate)
    const allHighlights = [...new Set(analyses.flatMap(a => a.key_highlights || []))];
    const allBullish = [...new Set(analyses.flatMap(a => a.bullish_factors || []))];
    const allBearish = [...new Set(analyses.flatMap(a => a.bearish_factors || []))];

    const providers = analyses.map(a => a.provider);

    return {
      providers: providers,
      // Database fields (what server.js saves)
      brief_summary: `${consensusSentiment.charAt(0).toUpperCase() + consensusSentiment.slice(1)} consensus from ${providers.join(', ')} (${avgConfidence}% confidence). ${allHighlights.slice(0, 2).join('. ')}`,
      detailed_summary: `Consensus from ${analyses.length} AI models: ${providers.join(', ')}. ${analyses.map(a => a.reasoning).filter(Boolean).join(' ')}`,
      sentiment_direction: consensusSentiment,
      expected_move_min: Math.min(...analyses.map(a => parseFloat(a.expected_move_min))).toFixed(2),
      expected_move_max: Math.max(...analyses.map(a => parseFloat(a.expected_move_max))).toFixed(2),
      expected_move_avg: avgPredictedChange.toFixed(2),
      confidence_score: avgConfidence,
      bullish_factors: allBullish.slice(0, 3),
      bearish_factors: allBearish.slice(0, 3),
      ai_consensus: {
        providers: providers,
        sentiment: consensusSentiment,
        confidence: avgConfidence,
        predicted_change: parseFloat(avgPredictedChange.toFixed(2)),
        key_highlights: allHighlights.slice(0, 5)
      },
      // Original fields for direct use
      sentiment: consensusSentiment,
      confidence: avgConfidence,
      predicted_change: parseFloat(avgPredictedChange.toFixed(2)),
      key_highlights: allHighlights.slice(0, 5),
      reasoning: `Consensus from ${analyses.length} AI models: ${providers.join(', ')}`
    };
  }
}

module.exports = new AIAnalysisService();
