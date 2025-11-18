import aiProvider from './src/services/ai-provider';

async function testAI() {
  console.log('Testing AI provider...');
  try {
    const response = await aiProvider.complete('Say hello in 5 words', 'gemini');
    console.log('✅ Gemini works:', response);
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testAI();
