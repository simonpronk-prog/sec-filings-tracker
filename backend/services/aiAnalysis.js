const fetch = require('node-fetch');

class AIAnalysisService {
  constructor() {
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.geminiKey = process.env.GEMINI_API_KEY;
    this.grokKey = process.env.XAI_API_KEY;
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
    const today = new Date().toISOString().split('T')[0];
    return `You are a financial analyst. Today's date is ${today}. Analyze this ${formType} SEC filing for ${company}.

CRITICAL RULES FOR NUMBERS AND DATA:
- ONLY cite numbers (share counts, dollar amounts, percentages, dates) that appear VERBATIM in the filing text below.
- If the filing text is unclear or you cannot find a specific number, say "not specified in filing" rather than guessing.
- NEVER estimate, round, or invent any numerical figure. If the text says "403,025 shares" you must say "403,025 shares", not "approximately 400,000 shares" or "53 million shares".
- For dollar amounts, use exactly what the filing states. Do not calculate or convert unless the filing itself provides the conversion.
- Format all numbers for readability: use commas for thousands (e.g. 327,088 not 327088) and $ symbol for dollar amounts (e.g. $43,737,684.02 not 43737684.02).
- If the filing text appears truncated or incomplete, note this in your summary and only report numbers you can actually see.

Filing content (may be truncated):
${filingText.substring(0, 50000)}

Filing type context:
- 10-K / 10-Q / 20-F / 6-K: Financial reports — focus on revenue, earnings, guidance, risks
- 8-K: Material event — identify the event type (earnings, M&A, leadership change, etc.)
- Form 4 / Form 3 / Form 5: Insider transactions — who bought/sold, how many shares, at what price, is this bullish/bearish signal?
- Form 144: Proposed insider sale — who filed to sell, how many shares, estimated value if stated
- S-1 / S-4: Registration — IPO or merger details, valuation, use of proceeds
- SC 13D / SC 13G: Large shareholder — who owns how much, activist or passive?
- DEF 14A: Proxy — key votes, executive pay, board changes
- 13F-HR: Institutional holdings — what big funds bought/sold
- Other: Summarise the key investor-relevant facts

Provide your analysis in JSON format:
{
  "sentiment_direction": "bullish" or "bearish" or "neutral",
  "confidence": 85,
  "predicted_change": 5.2,
  "brief_summary": "One sentence plain-English summary. Only include specific numbers if they appear in the filing text above.",
  "detailed_summary": "2-3 sentence detailed summary with key numbers quoted directly from the filing.",
  "key_highlights": ["point1", "point2", "point3"],
  "bullish_factors": ["factor1", "factor2"],
  "bearish_factors": ["risk1", "risk2"],
  "reasoning": "2-3 sentence explanation of your overall assessment",
  "numbers_confidence": "high" or "low"
}

For "numbers_confidence":
- "high" = you found clear, specific numbers in the filing text and cited them exactly
- "low" = the filing text was unclear, truncated, or you could not locate specific figures`;
  }

  // Analyze filing with Claude (Anthropic)
  async analyzeWithClaude(filingText, company, formType) {
    if (!this.anthropicKey) {
      console.log('⚠️ No Anthropic API key configured');
      return null;
    }

    try {
      const prompt = this.buildPrompt(filingText, company, formType);

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
      const prompt = this.buildPrompt(filingText, company, formType);

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
      const prompt = this.buildPrompt(filingText, company, formType);

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.grokKey}`
        },
        body: JSON.stringify({
          model: 'grok-3',
          messages: [{
            role: 'user',
            content: prompt
          }]
        })
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`Grok API error body: ${errorBody}`);
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

    if (analyses.length === 1) {
      const a = analyses[0];
      const predictedChange = parseFloat(a.predicted_change) || 0;
      return {
        ...a,
        sentiment_direction: a.sentiment_direction || a.sentiment || 'neutral',
        confidence_score: a.confidence || 50,
        expected_move_avg: predictedChange.toFixed(2),
        expected_move_min: predictedChange.toFixed(2),
        expected_move_max: predictedChange.toFixed(2),
        detailed_summary: a.detailed_summary || a.reasoning || null,
        numbers_confidence: a.numbers_confidence || 'low',
        ai_consensus: {
          provider_count: 1,
          analyses: [{
            provider: a.provider,
            sentiment: a.sentiment_direction || a.sentiment,
            expected_move: predictedChange,
            confidence: a.confidence
          }]
        }
      };
    }

    // Calculate consensus sentiment
    const sentiments = analyses.map(a => a.sentiment_direction || a.sentiment);
    const sentimentCounts = sentiments.reduce((acc, s) => {
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const consensusSentiment = Object.keys(sentimentCounts)
      .sort((a, b) => sentimentCounts[b] - sentimentCounts[a])[0];

    // Average confidence and predicted change
    const avgConfidence = Math.round(
      analyses.reduce((sum, a) => sum + (a.confidence || 0), 0) / analyses.length
    );
    const avgPredictedChange =
      analyses.reduce((sum, a) => sum + (parseFloat(a.predicted_change) || 0), 0) / analyses.length;

    // Combine all highlights and factors (deduplicate similar ones)
    const allHighlights = [...new Set(analyses.flatMap(a => a.key_highlights || []))];
    const allBullish = [...new Set(analyses.flatMap(a => a.bullish_factors || []))];
    const allBearish = [...new Set(analyses.flatMap(a => a.bearish_factors || []))];

    // Use first available brief_summary, or build one from reasoning
    const brief_summary = analyses.find(a => a.brief_summary)?.brief_summary
      || analyses.find(a => a.reasoning)?.reasoning
      || `${consensusSentiment} consensus from ${analyses.length} AI models`;

    const providers = analyses.map(a => a.provider);

    return {
      providers,
      sentiment_direction: consensusSentiment,
      confidence_score: avgConfidence,
      predicted_change: parseFloat(avgPredictedChange.toFixed(2)),
      expected_move_avg: avgPredictedChange.toFixed(2),
      expected_move_min: Math.min(...analyses.map(a => parseFloat(a.predicted_change) || 0)).toFixed(2),
      expected_move_max: Math.max(...analyses.map(a => parseFloat(a.predicted_change) || 0)).toFixed(2),
      brief_summary,
      detailed_summary: analyses.find(a => a.detailed_summary)?.detailed_summary || null,
      key_highlights: allHighlights.slice(0, 5),
      bullish_factors: allBullish.slice(0, 3),
      bearish_factors: allBearish.slice(0, 3),
      numbers_confidence: analyses.every(a => a.numbers_confidence === 'high') ? 'high' : 'low',
      reasoning: `Consensus from ${analyses.length} AI models: ${providers.join(', ')}`,
      ai_consensus: {
        provider_count: analyses.length,
        analyses: analyses.map(a => ({
          provider: a.provider,
          sentiment: a.sentiment_direction || a.sentiment,
          expected_move: parseFloat(a.predicted_change) || 0,
          confidence: a.confidence
        }))
      }
    };
  }
}

module.exports = new AIAnalysisService();
