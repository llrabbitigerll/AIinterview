---
name: api-integration-troubleshooting
description: Diagnose and fix third-party API integration failures including WebSocket connections, authentication errors, URL misconfigurations, and response parsing issues. Use when encountering API connectivity problems, 404/403 errors, authentication failures, or unexpected response formats.
version: 1.0.0
author: Agent System
tags:
  - api
  - troubleshooting
  - websocket
  - authentication
  - debugging
requires:
  - network-access
  - file-read
  - file-write
---

# API Integration Troubleshooting Skill

## Overview

This skill provides a systematic approach to diagnose and fix third-party API integration failures. It covers WebSocket connections, REST API calls, authentication issues, URL configuration problems, and response parsing errors.

## When to Use This Skill

Invoke this skill when encountering:
- API connection failures (404, 403, 500 errors)
- WebSocket handshake failures
- Authentication/authorization errors
- Unexpected response formats or missing fields
- Service initialization blocking downstream functionality
- API version mismatches
- Timeout or connectivity issues

## Diagnostic Framework

### Understanding the Failure Chain

API integration failures often cascade through the system:

```
service.initialize()
  └─ api_client.connect()          ← Exception thrown
       └─ transport.connect(URL)    ← 404/403/Timeout
            └─ Initialization fails
                 └─ Downstream services never start
                      └─ User-facing features appear broken
```

**Key Principle**: Always isolate auxiliary service failures from core functionality.

## Troubleshooting Workflow

### Step 0: Consult Official Documentation (Highest Priority)

**Action**: When encountering URL 404s, authentication failures, or field parsing errors, immediately check the official API documentation.

**Process**:
1. Navigate to the service provider's official documentation site
2. Locate the specific API service being integrated
3. Verify the documentation version matches the intended service version
4. Check for deprecation notices or version updates

**Key Verification Points**:
- Is there a newer API version available?
- Has the documentation URL changed?
- Are there breaking changes in the latest version?

**Principle**: "Code may be outdated, documentation is always authoritative."

---

### Step 1: Isolated Direct Connection Test

**Action**: Create a minimal standalone test script to verify basic connectivity.

**Process**:
1. Write a minimal test script that only tests the API connection
2. Include only transport layer code (no business logic)
3. Print raw responses for inspection
4. Test authentication independently

**Test Script Template**:
```python
# test_api_direct.py - Minimal connectivity test
import asyncio
import json

async def test_connection():
    try:
        # Test basic connectivity
        response = await transport.connect(API_URL)
        print(f"Connection status: {response.status}")
        print(f"Raw response: {await response.text()}")
        
        # Test authentication
        auth_response = await test_auth()
        print(f"Auth response: {auth_response}")
        
    except Exception as e:
        print(f"Error type: {type(e).__name__}")
        print(f"Error message: {e}")

if __name__ == "__main__":
    asyncio.run(test_connection())
```

**Expected Outcomes**:
- Connection successful → Proceed to Step 2
- Connection failed → Check URL, network, firewall settings
- Authentication failed → Proceed to Step 2 for auth verification

---

### Step 2: Verify Against Official Documentation

**Action**: Cross-reference implementation with official documentation.

**Verification Checklist**:

| Aspect | Verification Point | Common Issues |
|--------|-------------------|---------------|
| **URL** | Full URL including path segments | Missing `/v1`, `/api`, or service-specific paths |
| **Protocol** | HTTP vs HTTPS, WebSocket vs WebSocket Secure | Wrong protocol for endpoint |
| **Authentication** | Algorithm, parameter order, encoding | Wrong signing method, incorrect parameter sorting |
| **Timestamp Format** | Unix seconds vs ISO 8601 vs milliseconds | Format mismatch causing auth failures |
| **Request Format** | JSON structure, required fields | Missing required fields, wrong nesting |
| **Response Format** | Field names, data structure | Parsing outdated field names |
| **Version** | Old vs new service versions | Using deprecated endpoints |

**Critical Checks**:

1. **URL Completeness**
   - ❌ Incorrect: `wss://api.example.com/`
   - ✅ Correct: `wss://api.example.com/v1/service/endpoint`

2. **Authentication Algorithm**
   - Verify signature input format
   - Confirm parameter sorting rules
   - Check encoding requirements (URL encoding vs base64)

3. **Response Field Names**
   - Old: `{"code": "0", "data": "..."}`
   - New: `{"msg_type": "result", "data": {...}}`

4. **Session Management**
   - Is session ID client-generated or server-assigned?
   - If server-assigned, capture from handshake response

**Version-Specific Warning**:
Many services maintain multiple API versions simultaneously. Always verify which version the account is provisioned for:
- Legacy services may use older authentication methods
- New services may require different endpoint structures
- Documentation may default to latest version while account uses older version

---

### Step 3: Analyze Server-Side Logs and Error Codes

**Action**: Examine error responses and server logs for diagnostic information.

**HTTP Status Codes**:
| Code | Meaning | Common Causes |
|------|---------|---------------|
| 404 | Not Found | Incorrect URL, missing path, service not deployed |
| 403 | Forbidden | Authentication failure, missing permissions, IP whitelist |
| 401 | Unauthorized | Invalid credentials, expired token |
| 500 | Internal Server Error | Service-side issue, check provider status page |
| 502/503 | Service Unavailable | Service temporarily down, rate limiting |
| 101 | WebSocket Upgrade Success | Protocol switch successful |

**Service-Specific Error Codes**:
- Look up error codes in official documentation
- Common patterns: `10110` = invalid signature, `10001` = parameter error
- Do not guess meanings - always verify with documentation

**Log Inspection Commands**:
```bash
# View real-time server logs
python -m uvicorn app.main:app --log-level debug

# Check service status
curl -I https://api.example.com/health

# Verify port listening
netstat -ano | findstr ":PORT"
```

---

### Step 4: Inspect Integration-Side Code

**Action**: Review how the API client is integrated into the application.

**Critical Inspection Points**:

1. **Exception Handling**
   - Are exceptions being silently caught and ignored?
   - Is error information being propagated or swallowed?
   - Check for bare `except:` clauses that hide errors

2. **Failure Propagation**
   - Does auxiliary service failure block core functionality?
   - Are initialization steps properly isolated?

3. **Error Reporting**
   - Are meaningful error messages sent to logs?
   - Is frontend notified of service degradation?

**Architecture Pattern - Fire-and-Forget with Fallback**:

```python
# Correct: Non-blocking initialization with error isolation
async def initialize_services(self):
    # Start ASR initialization in background
    asyncio.create_task(self._init_asr_async())
    
    # Immediately notify core service ready
    await self._send_json({"type": "service_ready", ...})

async def _init_asr_async(self):
    try:
        await self.asr.start_stream(...)
        await self._send_json({"type": "asr_status", "available": True})
    except Exception as e:
        logger.error(f"ASR initialization failed: {e}")
        await self._send_json({"type": "asr_status", "available": False})
```

```python
# Incorrect: Blocking initialization that cascades failures
async def initialize_services(self):
    await self.asr.start_stream(...)  # Fails → entire session hangs
    await self._send_json({"type": "service_ready", ...})
```

---

## Common Integration Checklist

When integrating a new third-party API, verify:

- [ ] **Service Version**: Confirm which API version the account supports
- [ ] **URL Completeness**: Full URL including all path segments
- [ ] **Authentication**: Parameter sorting, encoding, hashing algorithm
- [ ] **Timestamp Format**: Unix seconds, milliseconds, or ISO 8601
- [ ] **Response Format**: Field names, nesting structure, data types
- [ ] **Session ID Source**: Client-generated vs server-assigned
- [ ] **Termination Signal**: Required fields for graceful shutdown
- [ ] **Error Handling**: Non-blocking initialization for auxiliary services

---

## Prevention Strategies

### 1. Documentation Comments

Add version-specific comments at the top of integration files:

```python
# api_client.py
# Service: Example API - Real-time Speech Recognition (LLM Version)
# Documentation: https://docs.example.com/api/v2/speech
# Note: This is the NEW version (2023+), NOT the legacy rtasr service
# URL: wss://api.example.com/v2/speech/websocket
```

### 2. Startup Health Checks

Implement proactive health verification:

```python
@app.on_event("startup")
async def startup_health_check():
    try:
        result = await test_api_connection()
        logger.info(f"API health check: {result}")
    except Exception as e:
        logger.warning(f"API unavailable at startup: {e}")
```

### 3. Maintain Test Scripts

Keep standalone test scripts for rapid diagnosis:

```
project/
├── tests/
│   └── integration/
│       └── test_api_direct.py    # Keep this file!
```

---

## Key Takeaways

1. **Always verify documentation first** - Code comments may be outdated
2. **Isolate auxiliary services** - ASR/TTS failures shouldn't break core features
3. **Test connectivity independently** - Before debugging integration logic
4. **Check for version mismatches** - Old code + new service = common failure
5. **Preserve error information** - Don't let exceptions get swallowed
6. **Implement graceful degradation** - Notify users of reduced functionality

---

## Quick Reference: Error Symptoms → Likely Causes

| Symptom | Likely Cause | Check |
|---------|--------------|-------|
| HTTP 404 | Wrong URL | Path segments, service version |
| HTTP 403/401 | Auth failure | Algorithm, timestamp format, credentials |
| Connection timeout | Network/firewall | Connectivity test, IP whitelist |
| Parse errors | Response format change | Field names, documentation version |
| Silent failure | Exception swallowed | try/except blocks, error logging |
| Feature unavailable | Initialization blocked | Async isolation, error propagation |
