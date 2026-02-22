// SEC EDGAR API Service
const fetch = require('node-fetch');

class SECEdgarService {
  constructor() {
    this.baseUrl = 'https://www.sec.gov';
    this.edgarUrl = 'https://data.sec.gov';
    this.userAgent = 'SEC Filings Tracker support@secfilings.com';
  }

  // Search for companies
  async searchCompanies(query) {
    try {
      // Use SEC's company tickers JSON file
      const response = await fetch(`https://www.sec.gov/files/company_tickers.json`, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!response.ok) {
        throw new Error(`SEC API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Convert object to array and filter
      const companies = Object.values(data);
      const searchLower = query.toLowerCase();
      
      const results = companies.filter(company => 
        company.title.toLowerCase().includes(searchLower) ||
        company.ticker.toLowerCase().includes(searchLower)
      ).map(company => ({
        cik: String(company.cik_str).padStart(10, '0'),
        name: company.title,
        ticker: company.ticker
      }));

      return results.slice(0, 20); // Return top 20 matches
    } catch (error) {
      console.error('Search error:', error);
      throw error;
    }
  }

  // Get recent filings for a CIK
  async getCompanyFilings(cik, daysBack = 7) {
    try {
      const paddedCik = String(cik).replace(/^0+/, '').padStart(10, '0');
      const url = `${this.edgarUrl}/submissions/CIK${paddedCik}.json`;
      
      console.log(`📡 Fetching from: ${url}`);
      
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch filings: ${response.status}`);
      }

      const data = await response.json();
      console.log(`✅ Got data for ${data.name}`);
      
      const filings = [];
      
      // Set cutoff to start of day, daysBack days ago
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysBack);
      cutoffDate.setHours(0, 0, 0, 0); // Start of day
      console.log(`📅 Cutoff date: ${cutoffDate.toISOString()}`);

      const recentFilings = data.filings.recent;
      console.log(`📊 Total filings in API: ${recentFilings.accessionNumber.length}`);
      
      for (let i = 0; i < recentFilings.accessionNumber.length; i++) {
        const filedDate = recentFilings.filingDate[i];
        const filingDateObj = new Date(filedDate + 'T00:00:00'); // Ensure consistent parsing
        
        if (filingDateObj >= cutoffDate) {
          const formType = recentFilings.form[i];
          const priority = this.getFilingPriority(formType);
          
          filings.push({
            cik: String(cik).padStart(10, '0'),
            company: data.name,
            formType,
            filedDate,
            accessionNumber: recentFilings.accessionNumber[i],
            description: this.getFilingDescription(formType),
            primaryDocument: recentFilings.primaryDocument[i],
            reportDate: recentFilings.reportDate[i] || null,
            priority
          });
        }
      }

      console.log(`✅ Returning ${filings.length} filings after date filter`);
      return filings;
    } catch (error) {
      console.error('Error fetching filings:', error);
      throw error;
    }
  }

  getFilingUrl(cik, accessionNumber) {
    const paddedCik = String(cik).padStart(10, '0');
    return `${this.baseUrl}/cgi-bin/viewer?action=view&cik=${paddedCik}&accession_number=${accessionNumber}`;
  }

  // Get raw filing text
  async getFilingText(accessionNumber, cik, primaryDocument) {
    try {
      const cleanAccession = accessionNumber.replace(/-/g, '');
      const numericCik = String(cik).replace(/^0+/, '');
      
      // Fetch the complete submission .txt file
      // Folder uses no dashes, filename keeps dashes
      const txtUrl = `${this.baseUrl}/Archives/edgar/data/${numericCik}/${cleanAccession}/${accessionNumber}.txt`;
      console.log(`📄 Fetching complete submission: ${txtUrl}`);
      
      const response = await fetch(txtUrl, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch filing text: ${response.status}`);
      }

      const content = await response.text();
      console.log(`✅ Got complete submission (${content.length} chars, ${content.split('<DOCUMENT>').length - 1} documents)`);
      
      return content;
    } catch (error) {
      console.error('Error fetching filing text:', error);
      throw error;
    }
  }

  // Parse and extract key information from filing
  async parseFilingContent(accessionNumber, cik, primaryDocument) {
    try {
      console.log('🚀 [VERSION 2.2] Strips inline XBRL headers from primaryDocument for clean text extraction');
      
      const content = await this.getFilingText(accessionNumber, cik, primaryDocument);
      
      // The .txt file contains multiple <DOCUMENT> sections
      // We want the one where <TYPE> is the main form (10-K, 10-Q, 8-K) not exhibits (EX-) or XML
      const documentSections = content.split('<DOCUMENT>');
      console.log(`🔍 Found ${documentSections.length - 1} document sections`);
      
      let mainDocument = null;
      let mainDocType = null;
      let primaryDocMatch = null;

      for (let i = 1; i < documentSections.length; i++) {
        const section = documentSections[i];
        const typeMatch = section.match(/<TYPE>([^\n]+)/);
        const filenameMatch = section.match(/<FILENAME>([^\n]+)/);
        const type = typeMatch ? typeMatch[1].trim() : null;
        const filename = filenameMatch ? filenameMatch[1].trim().toLowerCase() : '';

        console.log(`  📄 Document ${i}: TYPE=${type}, FILENAME=${filename}, size=${section.length} chars`);

        // First priority: match the primaryDocument filename from SEC EDGAR metadata
        // But skip if it's an XML file — XML primaryDocuments (e.g. primary_doc.xml for Form 144)
        // contain machine-readable XBRL, not human-readable content
        if (primaryDocument && filename === primaryDocument.toLowerCase()) {
          if (filename.endsWith('.xml')) {
            console.log(`  ⏭️ Skipping XML primaryDocument: ${primaryDocument} (machine-readable)`);
          } else {
            primaryDocMatch = section;
            console.log(`  ⭐ Matched primaryDocument: ${primaryDocument}`);
            continue;
          }
        }

        // Skip exhibits
        if (type && type.startsWith('EX-')) {
          console.log(`  ⏭️ Skipping exhibit`);
          continue;
        }

        // Skip XML/XBRL files - these are machine-readable metadata, not human-readable content
        if (filename.includes('.xml') || filename.includes('xbrl') || filename.includes('_htm.xml')) {
          console.log(`  ⏭️ Skipping XML/XBRL file`);
          continue;
        }

        // Skip graphics, binary, and metadata files
        if (type && (type.includes('GRAPHIC') || type.includes('ZIP') || type.includes('EXCEL') || type === 'XML' || type === 'JSON')) {
          console.log(`  ⏭️ Skipping non-content file (TYPE=${type})`);
          continue;
        }

        // Skip documents that are mostly XBRL/XML tags (inline XBRL in .htm files)
        const xbrlTagCount = (section.match(/<(ix:|xbrli:|xbrldi:)/gi) || []).length;
        if (xbrlTagCount > 100) {
          console.log(`  ⏭️ Skipping inline XBRL document (${xbrlTagCount} XBRL tags)`);
          continue;
        }

        // Fallback: select the LARGEST document that passes our filters
        if (type && section.length > (mainDocument?.length || 0)) {
          mainDocument = section;
          mainDocType = type;
          console.log(`  ✅ New candidate for main document (larger)`);
        }
      }

      // Prefer the primaryDocument match over the largest document
      if (primaryDocMatch) {
        mainDocument = primaryDocMatch;
        mainDocType = 'PRIMARY';
        console.log(`  ✅ Using primaryDocument match`);
      }
      
      if (!mainDocument) {
        console.log(`⚠️ Could not find main document, using entire content`);
        mainDocument = content;
        mainDocType = 'UNKNOWN';
      } else {
        console.log(`✅ Selected document: TYPE=${mainDocType}, SIZE=${mainDocument.length} chars`);
      }
      
      // Extract text from HTML (remove tags)
      // First strip inline XBRL header/hidden sections — these contain machine-readable
      // metadata (context refs, unit definitions) that pollute the extracted text.
      // The actual financial content is outside these sections.
      const textContent = mainDocument
        .replace(/<ix:header>[\s\S]*?<\/ix:header>/gi, '')
        .replace(/<ix:hidden>[\s\S]*?<\/ix:hidden>/gi, '')
        .replace(/<xbrli:context[\s\S]*?<\/xbrli:context>/gi, '')
        .replace(/<xbrli:unit[\s\S]*?<\/xbrli:unit>/gi, '')
        .replace(/<link:[\s\S]*?>/gi, '')
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#\d+;/g, ' ')
        .replace(/&[a-z]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Limit to first 50,000 characters to avoid token limits
      const result = textContent.substring(0, 50000);
      console.log(`📊 Extracted ${result.length} chars of text. First 200 chars: "${result.substring(0, 200)}..."`);
      return result;
    } catch (error) {
      console.error('Error parsing filing content:', error);
      throw error;
    }
  }

  getFilingDescription(formType) {
    const descriptions = {
      '10-K': 'Annual Report',
      '10-Q': 'Quarterly Report',
      '8-K': 'Current Report',
      '4': 'Insider Trading Statement',
      '3': 'Initial Statement of Beneficial Ownership',
      '5': 'Annual Statement of Beneficial Ownership',
      'DEF 14A': 'Proxy Statement',
      '13F-HR': 'Institutional Holdings Report',
      'S-1': 'Registration Statement',
      'SC 13G': 'Beneficial Ownership Report',
      'SC 13D': 'Beneficial Ownership Report'
    };

    return descriptions[formType] || formType;
  }

  getFilingPriority(formType) {
    const highPriority = ['10-K', '10-Q', '8-K'];
    const mediumPriority = ['DEF 14A', '13F-HR', 'SC 13G', 'SC 13D'];
    
    if (highPriority.includes(formType)) {
      return {
        level: 'high',
        emoji: '🔴',
        description: this.getFilingDescription(formType)
      };
    } else if (mediumPriority.includes(formType)) {
      return {
        level: 'medium',
        emoji: '🟡',
        description: this.getFilingDescription(formType)
      };
    } else {
      return {
        level: 'low',
        emoji: '🟢',
        description: this.getFilingDescription(formType)
      };
    }
  }

  // Get filing metadata without full text
  async getFilingMetadata(cik, accessionNumber) {
    try {
      const paddedCik = String(cik).padStart(10, '0');
      const url = `${this.baseUrl}/cgi-bin/viewer?action=view&cik=${paddedCik}&accession_number=${accessionNumber}`;
      
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent }
      });

      if (!response.ok) {
        return null;
      }

      const html = await response.text();
      
      // Extract company name
      const nameMatch = html.match(/<span class="companyName">([^<]+)/i);
      const company = nameMatch ? nameMatch[1].trim() : null;

      return {
        company,
        url
      };
    } catch (error) {
      console.error('Error fetching metadata:', error);
      return null;
    }
  }

  // Batch get filings for multiple CIKs
  async getBatchFilings(ciks, daysBack = 7) {
    const allFilings = [];
    
    for (const cik of ciks) {
      try {
        const filings = await this.getCompanyFilings(cik, daysBack);
        allFilings.push(...filings);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error fetching filings for CIK ${cik}:`, error);
      }
    }

    // Sort by date (newest first)
    return allFilings.sort((a, b) => 
      new Date(b.filedDate) - new Date(a.filedDate)
    );
  }

  // Alias for backward compatibility
  async getFilingsForWatchlist(ciks, daysBack = 7) {
    return this.getBatchFilings(ciks, daysBack);
  }
}

module.exports = new SECEdgarService();
// Force rebuild Sat  7 Feb 2026 14:32:01 GMT
