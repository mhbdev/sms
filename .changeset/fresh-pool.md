---
"@mhbdev/sms": patch
---

Add `SmsProviderPool` with pluggable priority and weighted round-robin routing,
provider health tracking, safe send retry/failover, and typed adapters for
provider-specific batch operations. Send requests no longer use the legacy HTTP
retry policy; uncertain delivery outcomes stop with an explicit pool error.
