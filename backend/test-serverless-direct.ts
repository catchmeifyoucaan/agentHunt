import axios from 'axios';

async function testServerless() {
  const apiKey = process.env.MODEL_ACCESS_KEY;
  const url = process.env.SERVERLESS_API_URL || 'https://inference.do-ai.run/v1/chat/completions';
  const model = process.env.SERVERLESS_MODEL || 'deepseek-r1-distill-llama-70b';
  
  console.log('Testing serverless API...');
  console.log('URL:', url);
  console.log('Model:', model);
  console.log('API Key:', apiKey ? apiKey.substring(0, 15) + '...' : 'MISSING');
  
  try {
    const response = await axios.post(url, {
      model: model,
      messages: [{ role: 'user', content: 'Say hello in 3 words' }],
      max_tokens: 50,
      temperature: 0.2
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ SUCCESS:', response.data.choices[0].message.content);
  } catch (error: any) {
    console.error('❌ ERROR:', error.response?.status, error.response?.data || error.message);
  }
}

testServerless();
