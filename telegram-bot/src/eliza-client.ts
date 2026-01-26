// ElizaOS API Client
const ELIZA_API_URL = process.env.ELIZA_API_URL || 'http://localhost:3001';

export interface ChatResponse {
  success: boolean;
  response?: string;
  agents_used?: string[];
  error?: string;
}

export interface TokenAnalysisResponse {
  success: boolean;
  analysis?: {
    summary: string;
    riskAssessment: string;
    recommendations: string[];
    marketSentiment: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
  };
  error?: string;
}

export async function callElizaAPI(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${ELIZA_API_URL}${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`ElizaOS API error: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error('ElizaOS API call failed:', error);
    throw error;
  }
}

export async function sendChatMessage(userId: number, message: string, context?: any): Promise<ChatResponse> {
  try {
    return await callElizaAPI('/api/chat', 'POST', {
      user_id: userId,
      message,
      context,
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get AI response',
    };
  }
}

export async function analyzeToken(chain: string, token: string): Promise<TokenAnalysisResponse> {
  try {
    return await callElizaAPI('/api/analyze-token', 'POST', {
      chain,
      token,
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to analyze token',
    };
  }
}

export async function getRiskAssessment(userId: number): Promise<any> {
  try {
    return await callElizaAPI(`/api/risk-assessment/${userId}`, 'GET');
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to get risk assessment',
    };
  }
}
