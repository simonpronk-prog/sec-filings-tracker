const fetch = require('node-fetch');

class AIAnalysisService {
  constructor() {
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.geminiKey = process.env.GEMINI_API_KEY;
    this.grokKey = process.env.XAI_API_KEY;
    this.pool = null;
  }

  // Set database pool for loading personas
  setPool(pool) {
    this.pool = pool;
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

  // Map form type to analysis category
  getAnalysisType(formType) {
    const typeMap = {
      '10-K': 'financial_report', '10-Q': 'financial_report', '20-F': 'financial_report', '6-K': 'financial_report',
      '8-K': 'event_report',
      '4': 'insider_trade', '3': 'insider_trade', '5': 'insider_trade', '144': 'insider_trade',
      'S-1': 'registration', 'S-4': 'registration',
      'SC 13D': 'shareholder_disclosure', 'SC 13G': 'shareholder_disclosure', '13F-HR': 'shareholder_disclosure',
      'DEF 14A': 'proxy_statement'
    };
    return typeMap[formType] || 'other';
  }

  // Filing-type-specific instructions for the AI
  getFilingTypeInstructions(formType) {
    const analysisType = this.getAnalysisType(formType);

    const instructions = {
      financial_report: `FINANCIAL REPORT ANALYSIS (${formType}):
Focus on revenue trends, earnings, margins, cash flow, guidance, and balance sheet health.
Extract these KPIs if present in the filing:
- Revenue (current period + YoY change)
- EPS (current + YoY change)
- Gross margin, Operating margin, Net margin
- Net income
- Free cash flow
- Total debt and cash/equivalents
- Revenue guidance and EPS guidance (if provided)
- Shares outstanding
- Dividend info
- Capital expenditure
- Business segment performance
- Any new metrics or one-time items`,

      insider_trade: `INSIDER TRANSACTION ANALYSIS (${formType}):
Focus on WHO traded, WHAT they traded, HOW MUCH, and WHETHER this signals conviction.
Extract these KPIs if present in the filing:
- Insider name and title
- Transaction type (purchase, sale, option exercise, gift)
- Number of shares transacted
- Price per share
- Total transaction value
- Shares owned after transaction
- Ownership change percentage
- Whether this is a 10b5-1 pre-planned trade
- Historical context (have they been buying or selling lately?)`,

      event_report: `MATERIAL EVENT ANALYSIS (8-K):
Identify the specific event type and assess its market impact.
Extract these KPIs if present:
- Event type (earnings, M&A, leadership change, restructuring, new contract, etc.)
- Event description
- Deal value (if M&A)
- Financial impact stated
- Effective date
- Revenue impact
- Key terms and conditions`,

      shareholder_disclosure: `SHAREHOLDER DISCLOSURE ANALYSIS (${formType}):
Focus on WHO owns WHAT and WHY — activist vs passive, accumulating vs reducing.
Extract these KPIs if present:
- Filer name and type (hedge fund, mutual fund, activist, etc.)
- Total shares held
- Ownership percentage
- Change in shares from last filing
- Stated purpose (passive investment, activist campaign, etc.)`,

      proxy_statement: `PROXY STATEMENT ANALYSIS (DEF 14A):
Focus on executive compensation, board changes, and key shareholder votes.
Extract these KPIs if present:
- CEO total compensation and YoY change
- Say-on-pay recommendation
- Board member changes (new, departing)
- Key proposals up for vote
- Any shareholder proposals`,

      registration: `REGISTRATION STATEMENT ANALYSIS (${formType}):
Focus on IPO/merger details, valuation, use of proceeds, and key risks.
Extract relevant KPIs about the offering or transaction.`,

      other: `GENERAL SEC FILING ANALYSIS (${formType}):
Summarize the key investor-relevant facts from this filing.
Extract any financial metrics, dates, or material facts present.`
    };

    return instructions[analysisType] || instructions.other;
  }

  // Get KPI template based on filing type
  getKpiTemplate(formType) {
    const analysisType = this.getAnalysisType(formType);

    const templates = {
      financial_report: `"kpis": {
    "revenue": "exact figure or null",
    "revenue_yoy_change": "percentage or null",
    "eps": "exact figure or null",
    "eps_yoy_change": "percentage or null",
    "gross_margin": "percentage or null",
    "operating_margin": "percentage or null",
    "net_margin": "percentage or null",
    "net_income": "exact figure or null",
    "free_cash_flow": "exact figure or null",
    "total_debt": "exact figure or null",
    "cash_and_equivalents": "exact figure or null",
    "revenue_guidance": "exact figure or range or null",
    "eps_guidance": "exact figure or range or null",
    "shares_outstanding": "exact figure or null",
    "dividend": "exact figure or null",
    "capex": "exact figure or null",
    "segments": [{"name": "segment name", "revenue": "figure", "growth": "percentage"}],
    "new_metrics": [{"label": "metric name", "value": "figure"}]
  }`,
      insider_trade: `"kpis": {
    "insider_name": "full name",
    "insider_title": "title/role",
    "transaction_type": "purchase/sale/option_exercise/gift",
    "shares_transacted": "exact number",
    "price_per_share": "exact price",
    "total_value": "exact value",
    "shares_owned_after": "exact number or null",
    "ownership_change_pct": "percentage or null",
    "is_10b5_1_plan": true/false/null,
    "historical_context": "brief note on pattern"
  }`,
      event_report: `"kpis": {
    "event_type": "earnings/merger/leadership_change/restructuring/contract/other",
    "event_description": "one sentence",
    "deal_value": "exact figure or null",
    "financial_impact": "description or null",
    "effective_date": "date or null",
    "revenue_impact": "description or null",
    "key_terms": ["term1", "term2"]
  }`,
      shareholder_disclosure: `"kpis": {
    "filer_name": "entity name",
    "filer_type": "hedge_fund/mutual_fund/activist/individual/other",
    "shares_held": "exact number",
    "ownership_pct": "percentage",
    "change_in_shares": "exact number or null",
    "stated_purpose": "passive/activist/other description"
  }`,
      proxy_statement: `"kpis": {
    "ceo_total_comp": "exact figure or null",
    "ceo_comp_change": "percentage or null",
    "say_on_pay_recommendation": "for/against/null",
    "board_changes": [{"name": "person", "action": "joining/departing"}],
    "key_proposals": ["proposal1", "proposal2"]
  }`,
      registration: `"kpis": {
    "offering_type": "IPO/merger/secondary",
    "shares_offered": "number or null",
    "price_range": "range or null",
    "use_of_proceeds": "description or null",
    "valuation": "figure or null"
  }`,
      other: `"kpis": {}`
    };

    return templates[analysisType] || templates.other;
  }

  // Load personas from database, filtered by user preferences
  async loadPersonas(userPersonaPrefs = null) {
    if (!this.pool) {
      console.log('⚠️ No database pool set, using empty personas');
      return [];
    }

    try {
      // Get all globally enabled personas
      const result = await this.pool.query(
        'SELECT name, short_name, emoji, framework, key_metrics, style FROM analyst_personas WHERE enabled = true ORDER BY is_default DESC, created_at ASC'
      );

      let personas = result.rows;

      // If user has persona preferences, filter to only their selected ones
      if (userPersonaPrefs && typeof userPersonaPrefs === 'object') {
        personas = personas.filter(p => userPersonaPrefs[p.short_name] !== false);
      }
      // If userPersonaPrefs is null, all globally enabled personas are included (default)

      return personas;
    } catch (error) {
      console.error('Error loading personas:', error);
      return [];
    }
  }

  // Build the persona-driven prompt for all AI providers
  async buildPrompt(filingText, company, formType, userPersonaPrefs = null) {
    const today = new Date().toISOString().split('T')[0];
    const analysisType = this.getAnalysisType(formType);
    const filingInstructions = this.getFilingTypeInstructions(formType);
    const kpiTemplate = this.getKpiTemplate(formType);

    // Load personas from DB, filtered by user preferences
    const personas = await this.loadPersonas(userPersonaPrefs);

    // Build persona section
    let personaSection = '';
    let personaTakesTemplate = '';

    if (personas.length > 0) {
      personaSection = `\n\nANALYST PANEL — You have access to the analytical frameworks of these market professionals. Channel each one's perspective when crafting their "take":\n`;

      for (const p of personas) {
        const metrics = Array.isArray(p.key_metrics) ? p.key_metrics.join(', ') : p.key_metrics;
        personaSection += `\n${p.emoji} ${p.name} (${p.short_name}):
- Framework: ${p.framework}
- Key metrics they focus on: ${metrics}
- Communication style: ${p.style}\n`;
      }

      const takesEntries = personas.map(p =>
        `    {"persona": "${p.short_name}", "name": "${p.name}", "emoji": "${p.emoji}", "take": "1-2 sentence take in ${p.name}'s voice and style, referencing what THEY would focus on from this filing"}`
      ).join(',\n');

      personaTakesTemplate = `"persona_takes": [\n${takesEntries}\n  ]`;
    } else {
      personaTakesTemplate = `"persona_takes": []`;
    }

    return `You are a team of elite stock analysts dissecting an SEC filing. Today's date is ${today}.
Analyze this ${formType} filing for ${company}.
${personaSection}

CRITICAL RULES FOR NUMBERS AND DATA:
- ONLY cite numbers (share counts, dollar amounts, percentages, dates) that appear VERBATIM in the filing text below.
- If the filing text is unclear or you cannot find a specific number, use null rather than guessing.
- NEVER estimate, round, or invent any numerical figure. If the text says "403,025 shares" you must say "403,025 shares", not "approximately 400,000 shares".
- For dollar amounts, use exactly what the filing states. Do not calculate or convert unless the filing itself provides the conversion.
- Format all numbers for readability: use commas for thousands and $ symbol for dollar amounts.
- If the filing text appears truncated or incomplete, note this and only report numbers you can actually see.
- Every bullish and bearish factor MUST cite a specific number or fact from the filing. No generic statements.

${filingInstructions}

Filing content (may be truncated):
${filingText.substring(0, 50000)}

Provide your COMPLETE analysis as a single JSON object. No text before or after the JSON.

{
  "sentiment_direction": "bullish" or "bearish" or "neutral",
  "confidence": 85,
  "predicted_change": 5.2,
  "brief_summary": "One sentence plain-English summary with key numbers from the filing.",
  "detailed_summary": "2-3 sentence detailed summary with specific numbers quoted from the filing.",
  "key_highlights": ["point1", "point2", "point3"],
  "bullish_factors": ["Each factor MUST cite a specific number or fact from the filing - up to 10"],
  "bearish_factors": ["Each factor MUST cite a specific number or fact from the filing - up to 10"],
  "reasoning": "2-3 sentence explanation of your overall assessment",
  "numbers_confidence": "high" or "low",
  "pro_analysis": {
    "version": 1,
    "analysis_type": "${analysisType}",
    "analyst_note": "2-3 paragraphs of professional research note. Write like a senior equity research analyst covering what matters most about this filing — the story, the numbers, and what to watch. Reference specific figures from the filing.",
    ${kpiTemplate},
    "management_signals": {
      "tone": "confident/cautious/defensive/optimistic/neutral or null",
      "guidance_direction": "raised/lowered/maintained/initiated/withdrawn or null",
      "buyback_announced": false,
      "insider_buying": false,
      "key_quote": "Most important direct quote from management, if any, or null"
    },
    "action_items": ["Specific dated catalysts or things to watch — e.g. 'Earnings call March 15', 'FDA decision expected Q2'"],
    ${personaTakesTemplate}
  }
}

For "numbers_confidence":
- "high" = you found clear, specific numbers in the filing text and cited them exactly
- "low" = the filing text was unclear, truncated, or you could not locate specific figures

IMPORTANT: Return ONLY the JSON object. No markdown code fences, no explanatory text.`;
  }

  // Improved JSON extraction — handles nested objects properly
  extractJSON(text) {
    // Try to find JSON by matching first { to its balanced closing }
    let depth = 0;
    let start = -1;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            const jsonStr = text.substring(start, i + 1);
            return JSON.parse(jsonStr);
          } catch (e) {
            // If parse fails, continue looking
            start = -1;
          }
        }
      }
    }

    // Fallback: try greedy regex
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('No valid JSON found in response');
  }

  // Analyze filing with Claude (Anthropic)
  async analyzeWithClaude(filingText, company, formType, userPersonaPrefs) {
    if (!this.anthropicKey) {
      console.log('⚠️ No Anthropic API key configured');
      return null;
    }

    try {
      const prompt = await this.buildPrompt(filingText, company, formType, userPersonaPrefs);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
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

      const analysis = this.extractJSON(text);

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
  async analyzeWithGemini(filingText, company, formType, userPersonaPrefs) {
    if (!this.geminiKey) {
      console.log('⚠️ No Gemini API key configured');
      return null;
    }

    try {
      const prompt = await this.buildPrompt(filingText, company, formType, userPersonaPrefs);

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${this.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            maxOutputTokens: 4096
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;

      const analysis = this.extractJSON(text);

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
  async analyzeWithGrok(filingText, company, formType, userPersonaPrefs) {
    if (!this.grokKey) {
      console.log('⚠️ No Grok API key configured');
      return null;
    }

    try {
      const prompt = await this.buildPrompt(filingText, company, formType, userPersonaPrefs);

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.grokKey}`
        },
        body: JSON.stringify({
          model: 'grok-3',
          max_tokens: 4096,
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

      const analysis = this.extractJSON(text);

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
  async analyzeFiling(filingText, company, formType, ticker, aiPreferences = null, personaPreferences = null) {
    console.log(`🤖 Analyzing ${formType} filing for ${company}...`);

    // Default to all AIs if no preferences provided
    const prefs = aiPreferences || { claude: true, gemini: true, grok: true };
    console.log('🎯 Using AIs:', Object.keys(prefs).filter(k => prefs[k]).join(', '));

    // Run selected AI analyses in parallel
    const analyses = await Promise.all([
      prefs.claude ? this.analyzeWithClaude(filingText, company, formType, personaPreferences) : null,
      prefs.gemini ? this.analyzeWithGemini(filingText, company, formType, personaPreferences) : null,
      prefs.grok ? this.analyzeWithGrok(filingText, company, formType, personaPreferences) : null
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
        pro_analysis: a.pro_analysis || null,
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

    // Combine all highlights and factors (deduplicate similar ones) — up to 10 each
    const allHighlights = [...new Set(analyses.flatMap(a => a.key_highlights || []))];
    const allBullish = [...new Set(analyses.flatMap(a => a.bullish_factors || []))];
    const allBearish = [...new Set(analyses.flatMap(a => a.bearish_factors || []))];

    // Use first available brief_summary, or build one from reasoning
    const brief_summary = analyses.find(a => a.brief_summary)?.brief_summary
      || analyses.find(a => a.reasoning)?.reasoning
      || `${consensusSentiment} consensus from ${analyses.length} AI models`;

    const providers = analyses.map(a => a.provider);

    // Pick pro_analysis from the highest-confidence provider
    const sortedByConfidence = [...analyses].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    const bestProAnalysis = sortedByConfidence.find(a => a.pro_analysis)?.pro_analysis || null;

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
      bullish_factors: allBullish.slice(0, 10),
      bearish_factors: allBearish.slice(0, 10),
      numbers_confidence: analyses.every(a => a.numbers_confidence === 'high') ? 'high' : 'low',
      reasoning: `Consensus from ${analyses.length} AI models: ${providers.join(', ')}`,
      pro_analysis: bestProAnalysis,
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
