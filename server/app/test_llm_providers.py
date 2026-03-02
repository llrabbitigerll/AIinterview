"""
Test script for LLM provider integration.
Run this to verify your Qwen/Moonshot/OpenAI configuration.

Usage:
    python test_llm_providers.py
"""
import asyncio
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.services.llm_service import llm_complete, llm_stream


async def test_provider(provider_name: str):
    """Test a specific LLM provider."""
    print(f"\n{'='*60}")
    print(f"Testing {provider_name.upper()} Provider")
    print(f"{'='*60}")
    
    original_provider = settings.LLM_PROVIDER
    settings.LLM_PROVIDER = provider_name
    
    try:
        # Test non-streaming completion
        print(f"\n📝 Test 1: Non-streaming completion")
        print(f"   Provider: {provider_name}")
        
        response = await llm_complete(
            messages=[
                {"role": "user", "content": "用一句话介绍你自己，并说明你的模型名称。"}
            ],
            temperature=0.7,
            max_tokens=100,
        )
        
        print(f"   ✅ Response: {response[:200]}")
        
        # Test streaming completion
        print(f"\n🌊 Test 2: Streaming completion")
        print(f"   Provider: {provider_name}")
        print(f"   Response: ", end="", flush=True)
        
        tokens = []
        async for token in llm_stream(
            messages=[
                {"role": "user", "content": "数到5，每个数字占一行。"}
            ],
            temperature=0.3,
            max_tokens=50,
        ):
            print(token, end="", flush=True)
            tokens.append(token)
        
        print()  # newline
        
        if tokens:
            print(f"   ✅ Received {len(tokens)} tokens")
        else:
            print(f"   ❌ No tokens received")
            
        print(f"\n✅ {provider_name.upper()} provider test PASSED")
        return True
        
    except Exception as e:
        print(f"\n❌ {provider_name.upper()} provider test FAILED")
        print(f"   Error: {type(e).__name__}: {e}")
        return False
        
    finally:
        settings.LLM_PROVIDER = original_provider


async def test_model_selection():
    """Test model selection based on provider."""
    print(f"\n{'='*60}")
    print(f"Testing Model Selection Logic")
    print(f"{'='*60}")
    
    test_cases = [
        ("qwen", settings.QWEN_MODEL_STRONG, settings.QWEN_MODEL_FAST),
        ("moonshot", settings.MOONSHOT_MODEL_STRONG, settings.MOONSHOT_MODEL_FAST),
        ("openai", settings.OPENAI_MODEL_STRONG, settings.OPENAI_MODEL_FAST),
    ]
    
    for provider, strong, fast in test_cases:
        print(f"\n{provider.upper()}:")
        print(f"  Strong Model: {strong}")
        print(f"  Fast Model:   {fast}")


async def main():
    """Run all tests."""
    print("🚀 LLM Provider Integration Test")
    print(f"Current Provider: {settings.LLM_PROVIDER}")
    print(f"Fallback Providers: {settings.LLM_FALLBACK_PROVIDERS}")
    
    # Test model configuration
    await test_model_selection()
    
    # Determine which providers to test
    providers_to_test = []
    
    if settings.QWEN_API_KEY and settings.QWEN_API_KEY != "sk-xxx":
        providers_to_test.append("qwen")
    
    if settings.MOONSHOT_API_KEY and settings.MOONSHOT_API_KEY != "sk-xxx":
        providers_to_test.append("moonshot")
    
    if settings.OPENAI_API_KEY and settings.OPENAI_API_KEY != "sk-xxx":
        providers_to_test.append("openai")
    
    if not providers_to_test:
        print("\n⚠️  No API keys configured!")
        print("   Please set at least one of: QWEN_API_KEY, MOONSHOT_API_KEY, OPENAI_API_KEY")
        print("   Copy .env.example to .env and fill in your keys.")
        return
    
    # Run tests
    results = {}
    for provider in providers_to_test:
        results[provider] = await test_provider(provider)
    
    # Summary
    print(f"\n{'='*60}")
    print("Test Summary")
    print(f"{'='*60}")
    
    for provider, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{provider.upper():12} {status}")
    
    total = len(results)
    passed = sum(results.values())
    print(f"\nTotal: {passed}/{total} providers working")
    
    if passed == 0:
        print("\n⚠️  All tests failed. Please check:")
        print("   1. API keys are correct")
        print("   2. Network connection is available")
        print("   3. API key has sufficient quota")


if __name__ == "__main__":
    asyncio.run(main())
